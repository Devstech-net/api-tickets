# API de Tickets Simoniz

Esta API permite gestionar el ciclo de vida de los tickets de soporte, conectándose a una base de datos SQL Server.

## Seguridad

La API implementa dos capas de seguridad:

1. **API Key**: Todas las peticiones (excepto `/api/health`) requieren la cabecera `x-api-key`.
2. **JWT**: Los endpoints protegidos de tickets requieren un token JWT en el header `Authorization: Bearer <token>`.

### Flujo de acceso
1. Envíe una petición a `/api/auth/token` incluyendo la cabecera `x-api-key`.
2. Use el token recibido para las peticiones a `/api/tickets`.

---

## Configuración del Entorno (.env)

Asegúrese de configurar las siguientes variables en su archivo `.env`:

```env
PORT=3000
API_KEY=su-llave-api
JWT_SECRET=su-secreto-jwt
JWT_EXPIRATION=24h

# SQL Server
DB_USER=usuario
DB_PASSWORD=password
DB_SERVER=servidor
DB_PORT=1433
DB_NAME=BaseDeDatos
DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=true

# CORS
ALLOWED_ORIGINS=http://localhost:3000,http://su-dominio.com
```

---

## Endpoints de Tickets

### 1. Listar Categorías
`GET /api/tickets/categories`

**Respuesta Exitosa (200 OK):**
```json
[
  {
    "id": 1,
    "name": "Soporte Técnico",
    "is_active": true,
    "created_at": "2026-04-16T15:38:37.123Z"
  },
  ...
]
```

### 2. Crear Ticket
`POST /api/tickets`

**Payload:**
```json
{
  "idUser": 101,
  "idCategory": 1,
  "title": "Problema con el acceso a VPN",
  "description": "No puedo conectar desde la oficina remota",
  "priority": "High"
}
```
*Valores de priority:* `Low`, `Medium`, `High`

**Respuesta Exitosa (201 Created):**
```json
{
  "id": 1,
  "uid": "X9J2K8L4",
  "idUser": 101,
  "idCategory": 1,
  "title": "Problema con el acceso a VPN",
  "description": "No puedo conectar desde la oficina remota",
  "status": "Open",
  "priority": "High",
  "created_at": "2026-04-16T15:40:00.000Z"
}
```

### 3. Listar Tickets (con filtros)
`GET /api/tickets?status=Open&uid=X9J`

**Parámetros query (opcionales):**
- `status`: `Open`, `In Progress`, `Resolved`, `Closed`
- `uid`: Búsqueda parcial por el identificador público.

**Respuesta Exitosa (200 OK):**
```json
{
  "total": 1,
  "tickets": [
    { ... }
  ]
}
```

### 4. Obtener Detalle de Ticket
`GET /api/tickets/:id` o `GET /api/tickets/:uid`

**Respuesta Exitosa (200 OK):**
```json
{
  "id": 1,
  "uid": "X9J2K8L4",
  "idUser": 101,
  "idCategory": 1,
  "title": "...",
  "status": "Open",
  "activities": [
    {
      "id": 1,
      "type": "creation",
      "author": "System",
      "content": "Ticket creado exitosamente.",
      "created_at": "..."
    }
  ]
}
```

### 5. Actualizar Estado de Ticket
`PATCH /api/tickets/:id`

**Payload:**
```json
{
  "status": "In Progress",
  "author": "Juan Perez",
  "authorRole": "Admin"
}
```
*Valores de status:* `Open`, `In Progress`, `Resolved`, `Closed`
*Valores de authorRole:* `User`, `Admin`, `System`

**Respuesta Exitosa (200 OK):**
Retorna el objeto Ticket actualizado.

### 6. Agregar Comentario / Actividad
`POST /api/tickets/:id/comments`

**Payload:**
```json
{
  "type": "message",
  "author": "Juan Perez",
  "authorRole": "Admin",
  "content": "Estamos revisando los logs del firewall."
}
```

**Respuesta Exitosa (201 Created):**
```json
{
  "id": 2,
  "idTicket": 1,
  "type": "message",
  "author": "Juan Perez",
  "content": "...",
  "created_at": "..."
}
```

### 7. Obtener Información de Código
`GET /api/tickets/code/:code`

Obtiene la información detallada de registro asociada a un código de Qualitor (`FidelissaCRM`).

**Respuesta Exitosa (200 OK):**
```json
{
  "cod": "A-LY39EKKZTK",
  "point": 100,
  "register_date": "2026-06-04T12:00:00.000Z",
  "fullname": "Nombre Completo",
  "documento": "Cédula de Ciudadanía",
  "email": "correo@ejemplo.com",
  "userAddress": "Calle 123 #45-67",
  "phone": "3001234567",
  "personalId": "1234567890",
  "stationId": 1,
  "stationName": "Estación Central",
  "brandId": 10,
  "address": "Avenida Siempre Viva 742",
  "marca": "Simoniz"
}
```

### 8. Obtener Información de Usuario
`GET /api/tickets/user/:id`

Obtiene la información detallada del perfil de un usuario registrado (`FidelissaCRM`).

**Respuesta Exitosa (200 OK):**
```json
{
  "fullname": "Nombre Completo",
  "documento": "Cédula de Ciudadanía",
  "marca": "Simoniz",
  "address": "Calle 123 #45-67"
}
```

---

## Manejo de Errores

### Datos Inválidos (400 Bad Request)
Ocurre cuando el payload no cumple con las reglas de validación (Zod).
```json
{
  "error": "Datos inválidos",
  "details": {
    "title": {
      "_errors": ["El título debe tener al menos 3 caracteres"]
    }
  }
}
```

### No Encontrado (404 Not Found)
Ocurre cuando el `id` o `uid` no existe.
```json
{
  "error": "Ticket no encontrado"
}
```

### No Autorizado (401 Unauthorized)
Ocurre cuando el token JWT o la API Key no son proporcionados.
```json
{
  "error": "API Key requerida",
  "message": "Debe proporcionar la cabecera x-api-key"
}
```

### Prohibido (403 Forbidden)
Ocurre cuando la API Key o el token JWT son inválidos.
```json
{
  "error": "API Key inválida",
  "message": "La llave proporcionada no es válida"
}
```
