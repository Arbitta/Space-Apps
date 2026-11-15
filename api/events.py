"""Autenticación por sesión, CSRF y autorización de cada recurso privado."""
from datetime import datetime, timezone
from functools import wraps
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import uuid

from flask import Blueprint, current_app, request, session
from werkzeug.exceptions import UnsupportedMediaType
from werkzeug.security import check_password_hash, generate_password_hash
from api.responses import success
from services.api_service import ServiceError
from services.cache import utc_now

events_api=Blueprint('events_api',__name__,url_prefix='/api')

def store():return current_app.extensions['earthlens_store']
def service():return current_app.extensions['earthlens_events']
def body():
    if not request.is_json:raise UnsupportedMediaType()
    value=request.get_json()
    if not isinstance(value,dict):raise ServiceError('invalid_request','El cuerpo debe ser un objeto JSON.')
    return value

def user():
    uid=session.get('user_id')
    if not uid:return None
    with store().connect() as db:row=db.execute('SELECT id,username FROM users WHERE id=?',(uid,)).fetchone()
    return dict(row) if row else None

def protect(fn):
    @wraps(fn)
    def wrapped(*args,**kwargs):
        if not user():raise ServiceError('authentication_required','Iniciá sesión para acceder a tus datos.')
        if request.method not in {'GET','HEAD'}:csrf()
        return fn(*args,**kwargs)
    return wrapped

def csrf():
    expected=session.get('csrf_token');received=request.headers.get('X-CSRF-Token','')
    if not isinstance(expected,str) or not received.isascii() or not hmac.compare_digest(expected,received):
        raise ServiceError('csrf_invalid','La sesión cambió; recargá la página antes de guardar.')

@events_api.get('/session')
def get_session():
    if 'csrf_token' not in session:session['csrf_token']=secrets.token_urlsafe(32)
    return success({'user':user(),'csrf_token':session['csrf_token']})

@events_api.post('/session/<action>')
def authenticate(action):
    csrf()
    if action=='logout':session.clear();return success({'logged_out':True})
    if action not in {'login','register'}:raise ServiceError('invalid_request','Acción desconocida.')
    payload=body();name=payload.get('username');password=payload.get('password')
    if set(payload)!={'username','password'} or not isinstance(name,str) or not re.fullmatch(r'[A-Za-z0-9_.-]{3,60}',name) or not isinstance(password,str) or not 12<=len(password)<=200:
        raise ServiceError('invalid_request','Usuario de 3–60 caracteres y contraseña de 12–200 caracteres.')
    identity=hashlib.sha256((request.remote_addr or 'local').encode()+name.casefold().encode()).hexdigest()
    with store().connect() as db:
        attempt=db.execute('SELECT * FROM login_attempts WHERE identity=?',(identity,)).fetchone()
        if attempt and attempt['failures']>=10 and (datetime.now(timezone.utc)-datetime.fromisoformat(attempt['last_at'])).total_seconds()<900:
            raise ServiceError('rate_limited','Demasiados intentos; esperá quince minutos.')
        row=db.execute('SELECT * FROM users WHERE username=?',(name.casefold(),)).fetchone()
        failure=False
        if action=='register':
            if row:raise ServiceError('account_conflict','Ese nombre de usuario no está disponible.')
            identifier=uuid.uuid4().hex
            db.execute('INSERT INTO users VALUES(?,?,?,?)',(identifier,name.casefold(),generate_password_hash(password),utc_now()))
        else:
            # También calcula un hash ante usuario inexistente para reducir diferencias de tiempo.
            valid=check_password_hash(row['password_hash'] if row else generate_password_hash('dummy-password-unknown'),password)
            if not row or not valid:
                failures=attempt['failures']+1 if attempt and (datetime.now(timezone.utc)-datetime.fromisoformat(attempt['last_at'])).total_seconds()<900 else 1
                db.execute('INSERT OR REPLACE INTO login_attempts VALUES(?,?,?)',(identity,failures,utc_now()));failure=True
            else:identifier=row['id']
        if not failure:db.execute('DELETE FROM login_attempts WHERE identity=?',(identity,))
    if failure:raise ServiceError('authentication_required','Credenciales inválidas.')
    session.clear();session['user_id']=identifier;session['csrf_token']=secrets.token_urlsafe(32)
    return success({'user':{'id':identifier,'username':name.casefold()},'csrf_token':session['csrf_token']})

@events_api.get('/events')
@protect
def events():return success(service().list(session['user_id']))

@events_api.post('/events')
@protect
def create_event():return success(service().save(session['user_id'],body())),201

@events_api.get('/events/<event_id>')
@protect
def get_event(event_id):return success(service().get(session['user_id'],event_id))

@events_api.patch('/events/<event_id>')
@protect
def edit_event(event_id):return success(service().save(session['user_id'],body(),event_id))

@events_api.delete('/events/<event_id>')
@protect
def delete_event(event_id):service().delete(session['user_id'],event_id);return success({'deleted':True})

@events_api.get('/events/<event_id>/history')
@protect
def history(event_id):return success(service().history(session['user_id'],event_id))

@events_api.get('/events/<event_id>/forecast-history')
@protect
def forecast_history(event_id):
    if set(request.args)-{'variable','valid_time'}:raise ServiceError('invalid_request','Filtros desconocidos.')
    return success(service().forecast_history(session['user_id'],event_id,**request.args.to_dict()))

@events_api.post('/events/preview')
@protect
def preview():
    from services.events import validate_event
    event=validate_event(body(),service().data)
    result=current_app.extensions['earthlens_planning'].preview(event)
    result.pop('bundle',None)
    return success(result)

@events_api.get('/notifications')
@protect
def notifications():
    with store().connect() as db:rows=db.execute('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100',(session['user_id'],)).fetchall()
    return success([{**dict(r),'body':json.loads(r['body'])} for r in rows])

@events_api.patch('/notifications/<notification_id>')
@protect
def read_notification(notification_id):
    with store().connect() as db:
        if db.execute('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE user_id=? AND id=?',(utc_now(),session['user_id'],notification_id)).rowcount!=1:
            raise ServiceError('event_not_found','La notificación no existe.')
    return success({'read':True})


@events_api.get('/events/<event_id>/report.pdf')
@protect
def event_report(event_id):
    from flask import Response
    from services.reports import pdf_report
    event=service().get(session['user_id'],event_id);history=service().history(session['user_id'],event_id)
    sections=[('Evento',event),('Última evaluación guardada',history[0]['assessment'] if history else
        'Sin monitoreo todavía. No hay evaluación científica disponible.'),
        ('Historial',history[:10]),('Límites','No garantiza seguridad. Verificar avisos oficiales SMN y condiciones del lugar. Centroide de ciudad, sin análisis del sitio exacto.')]
    return Response(pdf_report('Plan de actividad · '+event['name'],sections),mimetype='application/pdf',
        headers={'Content-Disposition':'attachment; filename="earthlens-event.pdf"','Cache-Control':'no-store'})
