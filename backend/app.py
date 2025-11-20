from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os
from dotenv import load_dotenv
import uuid

load_dotenv()

# Initialize Flask app
app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///database.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'tu-clave-secreta-aqui')

# Enable CORS
CORS(app, resources={r"/*": {"origins": "*"}})

# Initialize extensions
db = SQLAlchemy(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# ==================== MODELS ====================

class Client(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(120), nullable=False, unique=True)
    phone = db.Column(db.String(20))
    company = db.Column(db.String(120))
    description = db.Column(db.Text)
    status = db.Column(db.String(20), default='active')  # active, pending, completed
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationship
    requirements = db.relationship('Requirement', backref='client', lazy=True, cascade='all, delete-orphan')
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'email': self.email,
            'phone': self.phone,
            'company': self.company,
            'description': self.description,
            'status': self.status,
            'createdAt': self.created_at.strftime('%Y-%m-%d %H:%M:%S'),
            'updatedAt': self.updated_at.strftime('%Y-%m-%d %H:%M:%S')
        }

class Requirement(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    client_id = db.Column(db.String(36), db.ForeignKey('client.id'), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    priority = db.Column(db.String(20), default='medium')  # low, medium, high
    status = db.Column(db.String(20), default='pending')  # pending, in_progress, completed
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'clientId': self.client_id,
            'title': self.title,
            'description': self.description,
            'priority': self.priority,
            'status': self.status,
            'createdAt': self.created_at.strftime('%Y-%m-%d %H:%M:%S'),
            'updatedAt': self.updated_at.strftime('%Y-%m-%d %H:%M:%S')
        }

# ==================== ROUTES ====================

# CLIENTS ROUTES
@app.route('/api/clients', methods=['GET'])
def get_clients():
    try:
        clients = Client.query.all()
        return jsonify({
            'success': True,
            'data': [client.to_dict() for client in clients]
        }), 200
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/clients', methods=['POST'])
def create_client():
    try:
        data = request.get_json()
        
        # Validate email uniqueness
        if Client.query.filter_by(email=data.get('email')).first():
            return jsonify({'success': False, 'error': 'Email ya existe'}), 400
        
        new_client = Client(
            name=data.get('name'),
            email=data.get('email'),
            phone=data.get('phone'),
            company=data.get('company'),
            description=data.get('description'),
            status=data.get('status', 'active')
        )
        
        db.session.add(new_client)
        db.session.commit()
        
        # Emit WebSocket event
        socketio.emit('client_created', {'client': new_client.to_dict()}, broadcast=True)
        
        return jsonify({
            'success': True,
            'data': new_client.to_dict()
        }), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/clients/<client_id>', methods=['GET'])
def get_client(client_id):
    try:
        client = Client.query.get(client_id)
        if not client:
            return jsonify({'success': False, 'error': 'Cliente no encontrado'}), 404
        
        return jsonify({
            'success': True,
            'data': client.to_dict()
        }), 200
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/clients/<client_id>', methods=['PUT'])
def update_client(client_id):
    try:
        client = Client.query.get(client_id)
        if not client:
            return jsonify({'success': False, 'error': 'Cliente no encontrado'}), 404
        
        data = request.get_json()
        client.name = data.get('name', client.name)
        client.email = data.get('email', client.email)
        client.phone = data.get('phone', client.phone)
        client.company = data.get('company', client.company)
        client.description = data.get('description', client.description)
        client.status = data.get('status', client.status)
        
        db.session.commit()
        
        # Emit WebSocket event
        socketio.emit('client_updated', {'client': client.to_dict()}, broadcast=True)
        
        return jsonify({
            'success': True,
            'data': client.to_dict()
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/clients/<client_id>', methods=['DELETE'])
def delete_client(client_id):
    try:
        client = Client.query.get(client_id)
        if not client:
            return jsonify({'success': False, 'error': 'Cliente no encontrado'}), 404
        
        db.session.delete(client)
        db.session.commit()
        
        # Emit WebSocket event
        socketio.emit('client_deleted', {'clientId': client_id}, broadcast=True)
        
        return jsonify({
            'success': True,
            'message': 'Cliente eliminado'
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

# REQUIREMENTS ROUTES
@app.route('/api/requirements', methods=['GET'])
def get_requirements():
    try:
        client_id = request.args.get('client_id')
        if client_id:
            requirements = Requirement.query.filter_by(client_id=client_id).all()
        else:
            requirements = Requirement.query.all()
        
        return jsonify({
            'success': True,
            'data': [req.to_dict() for req in requirements]
        }), 200
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/requirements', methods=['POST'])
def create_requirement():
    try:
        data = request.get_json()
        
        # Verify client exists
        client = Client.query.get(data.get('clientId'))
        if not client:
            return jsonify({'success': False, 'error': 'Cliente no encontrado'}), 404
        
        new_requirement = Requirement(
            client_id=data.get('clientId'),
            title=data.get('title'),
            description=data.get('description'),
            priority=data.get('priority', 'medium'),
            status=data.get('status', 'pending')
        )
        
        db.session.add(new_requirement)
        db.session.commit()
        
        # Emit WebSocket event
        socketio.emit('requirement_created', {'requirement': new_requirement.to_dict()}, broadcast=True)
        
        return jsonify({
            'success': True,
            'data': new_requirement.to_dict()
        }), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/requirements/<requirement_id>', methods=['PUT'])
def update_requirement(requirement_id):
    try:
        requirement = Requirement.query.get(requirement_id)
        if not requirement:
            return jsonify({'success': False, 'error': 'Requerimiento no encontrado'}), 404
        
        data = request.get_json()
        requirement.title = data.get('title', requirement.title)
        requirement.description = data.get('description', requirement.description)
        requirement.priority = data.get('priority', requirement.priority)
        requirement.status = data.get('status', requirement.status)
        
        db.session.commit()
        
        # Emit WebSocket event
        socketio.emit('requirement_updated', {'requirement': requirement.to_dict()}, broadcast=True)
        
        return jsonify({
            'success': True,
            'data': requirement.to_dict()
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/requirements/<requirement_id>', methods=['DELETE'])
def delete_requirement(requirement_id):
    try:
        requirement = Requirement.query.get(requirement_id)
        if not requirement:
            return jsonify({'success': False, 'error': 'Requerimiento no encontrado'}), 404
        
        db.session.delete(requirement)
        db.session.commit()
        
        # Emit WebSocket event
        socketio.emit('requirement_deleted', {'requirementId': requirement_id}, broadcast=True)
        
        return jsonify({
            'success': True,
            'message': 'Requerimiento eliminado'
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

# STATS ROUTE
@app.route('/api/stats', methods=['GET'])
def get_stats():
    try:
        total_clients = Client.query.count()
        active_requirements = Requirement.query.filter(Requirement.status != 'completed').count()
        completed_requirements = Requirement.query.filter_by(status='completed').count()
        
        return jsonify({
            'success': True,
            'data': {
                'totalClients': total_clients,
                'activeRequirements': active_requirements,
                'completedRequirements': completed_requirements
            }
        }), 200
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# HEALTH CHECK
@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({
        'success': True,
        'message': 'Backend is running'
    }), 200

# ==================== WEBSOCKET EVENTS ====================

@socketio.on('connect')
def handle_connect():
    print(f'Client conectado')
    emit('connection_response', {'data': 'Conectado al servidor'})

@socketio.on('disconnect')
def handle_disconnect():
    print(f'Client desconectado')

@socketio.on('join_dashboard')
def on_join_dashboard(data):
    join_room('dashboard')
    emit('user_joined', {'message': 'Te uniste al dashboard'}, to='dashboard')

@socketio.on('leave_dashboard')
def on_leave_dashboard(data):
    leave_room('dashboard')

# ==================== CREATE TABLES ====================

with app.app_context():
    db.create_all()

# ==================== RUN ====================
if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    if os.getenv('FLASK_ENV') == 'production':
        socketio.run(app, host='0.0.0.0', port=port, debug=False)
    else:
        socketio.run(app, host='0.0.0.0', port=port, debug=True)
