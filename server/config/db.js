import pg from 'pg';
import config from './config.js';

const { Pool } = pg;

// Pool de conexiones PostgreSQL
const pool = new Pool(config.DB);

// Evento de error para conexiones idle (evita crash del proceso)
pool.on('error', (err) => {
  console.error('[DB] Error inesperado en cliente idle:', err.message);
});

// Log de conexión al arrancar
pool.connect()
  .then(client => {
    console.log('[DB] ✓ Conexión PostgreSQL establecida');
    client.release();
  })
  .catch(err => {
    console.error('[DB] ✗ Error al conectar con PostgreSQL:', err.message);
    console.error('[DB]   Verifica que PostgreSQL esté corriendo y que las credenciales en .env sean correctas');
  });

/**
 * Ejecuta una query y devuelve todos los resultados como array.
 * Equivalente async a db.query() de CalendarTRD.
 * @param {string} sql - Query SQL con placeholders $1, $2, ...
 * @param {Array} params - Parámetros de la query
 * @returns {Promise<Array>} Filas resultantes
 */
export const query = async (sql, params = []) => {
  const result = await pool.query(sql, params);
  return result.rows;
};

/**
 * Ejecuta una query y devuelve solo la primera fila, o null si no hay resultados.
 * Equivalente async a db.queryOne() de CalendarTRD.
 * @param {string} sql
 * @param {Array} params
 * @returns {Promise<Object|null>}
 */
export const queryOne = async (sql, params = []) => {
  const result = await pool.query(sql, params);
  return result.rows[0] ?? null;
};

/**
 * Ejecuta una query de escritura (INSERT/UPDATE/DELETE) y devuelve el resultado completo.
 * Para INSERT ... RETURNING *, usar query() en su lugar.
 * @param {string} sql
 * @param {Array} params
 * @returns {Promise<pg.QueryResult>}
 */
export const run = async (sql, params = []) => {
  return await pool.query(sql, params);
};

/**
 * Ejecuta una función dentro de una transacción.
 * Si la función lanza error, hace ROLLBACK automático.
 * @param {Function} fn - Función async que recibe (client) y devuelve el resultado
 * @returns {Promise<*>} Lo que devuelva fn
 */
export const transaction = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Verifica el estado de la conexión con la base de datos.
 * @returns {Promise<boolean>}
 */
export const checkConnection = async () => {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
};

export default pool;
