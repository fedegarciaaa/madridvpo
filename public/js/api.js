/**
 * MadridVPO — Cliente API con gestión automática de JWT + refresh
 * Patrón heredado de CalendarTRD
 */

const API_BASE = '/api';

// Estado de autenticación
let _accessToken = localStorage.getItem('mvpo_token') || null;
let _user        = null;
try { _user = JSON.parse(localStorage.getItem('mvpo_user') || 'null'); } catch {}

// ── Helpers internos ───────────────────────────────────────
function _setToken(token) {
  _accessToken = token;
  if (token) localStorage.setItem('mvpo_token', token);
  else        localStorage.removeItem('mvpo_token');
}

function _setUser(user) {
  _user = user;
  if (user) localStorage.setItem('mvpo_user', JSON.stringify(user));
  else      localStorage.removeItem('mvpo_user');
}

// ── Refresh automático ─────────────────────────────────────
let _refreshPromise = null;
async function _doRefresh() {
  try {
    const r = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include' // envía la httpOnly cookie
    });
    if (!r.ok) throw new Error('refresh_failed');
    const data = await r.json();
    _setToken(data.data?.accessToken);
    _setUser(data.data?.usuario);
    return true;
  } catch {
    _setToken(null);
    _setUser(null);
    return false;
  }
}

async function _refresh() {
  if (!_refreshPromise) {
    _refreshPromise = _doRefresh().finally(() => { _refreshPromise = null; });
  }
  return _refreshPromise;
}

// ── Request central ────────────────────────────────────────
async function _request(method, path, body, retry = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (_accessToken) headers['Authorization'] = `Bearer ${_accessToken}`;

  const opts = { method, headers, credentials: 'include' };
  if (body !== undefined) opts.body = JSON.stringify(body);

  let res = await fetch(`${API_BASE}${path}`, opts);

  // Si 401 e intent de refresh
  if (res.status === 401 && retry) {
    const ok = await _refresh();
    if (ok) return _request(method, path, body, false);
    // Si no se pudo refrescar → disparar evento de logout
    window.dispatchEvent(new CustomEvent('mvpo:unauthorized'));
    throw new Error('No autenticado');
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
  return json.data ?? json;
}

// ── API pública ────────────────────────────────────────────
const api = {
  // Auth
  login:          (email, password) => _request('POST', '/auth/login', { email, password }),
  register:       (data)            => _request('POST', '/auth/register', data),
  logout:         ()                => _request('POST', '/auth/logout').finally(() => { _setToken(null); _setUser(null); }),
  me:             ()                => _request('GET',  '/auth/me'),

  // Promociones
  promociones:    (params={})       => _request('GET',  '/promociones' + _qs(params)),
  promocion:      (id)              => _request('GET',  `/promociones/${id}`),
  geojson:        ()                => _request('GET',  '/promociones/geojson'),
  actividad:      (limite=15)       => _request('GET',  `/promociones/actividad?limite=${limite}`),
  comentar:       (id, contenido, parent_id) => _request('POST', `/promociones/${id}/comentarios`, { contenido, parent_id }),

  // Promotoras
  promotoras:     ()                => _request('GET',  '/promotoras'),
  promotora:      (id)              => _request('GET',  `/promotoras/${id}`),

  // Alertas (Fase 3)
  alertas:          ()              => _request('GET',    '/alertas'),
  crearAlerta:      (data)          => _request('POST',   '/alertas', data),
  actualizarAlerta: (id, data)      => _request('PUT',    `/alertas/${id}`, data),
  borrarAlerta:     (id)            => _request('DELETE', `/alertas/${id}`),
  toggleAlerta:     (id)            => _request('PATCH',  `/alertas/${id}/toggle`),

  // Perfil (Fase 3)
  miPerfil:             ()          => _request('GET',  '/usuarios/me'),
  actualizarPerfil:     (data)      => _request('PUT',  '/usuarios/me', data),
  actualizarPreferencias:(data)     => _request('PUT',  '/usuarios/me/preferencias', data),
  actualizarExpediente: (data)      => _request('PUT',  '/usuarios/me/expediente', data),
  cambiarPassword:      (data)      => _request('PUT',  '/usuarios/me/password', data),

  // Noticias (Fase 6)
  noticias:       (params={})       => _request('GET',  '/noticias' + _qs(params)),

  // Getters de estado
  getUser:  () => _user,
  getToken: () => _accessToken,
  isLogged: () => !!_accessToken && !!_user,
  isPremium:() => _user?.plan === 'premium' || _user?.rol === 'admin',
  isAdmin:  () => _user?.rol === 'admin',

  // Setters (para usar tras login externo)
  setToken: _setToken,
  setUser:  _setUser,
};

function _qs(params) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.append(k, v); });
  const s = q.toString();
  return s ? '?' + s : '';
}

export default api;
