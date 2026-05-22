import mysql.connector
import os
from mysql.connector import pooling

db_config = {
    "host": os.environ.get("DB_HOST"),
    "user": os.environ.get("DB_USER"),
    "password": os.environ.get("DB_PASSWORD"),
    "database": os.environ.get("DB_NAME"),
    "port": int(os.environ.get("DB_PORT", 3306)),
    "ssl_disabled": False,
    "connection_timeout": int(os.environ.get("DB_CONNECTION_TIMEOUT", "10")),
}

connection_pool = pooling.MySQLConnectionPool(
    pool_name="stockwise_pool",
    pool_size=int(os.environ.get("DB_POOL_SIZE", "3")),
    # Render was timing out while mysql-connector reset pooled sessions during
    # conn.close(). Reusing pooled connections without a reset keeps page loads
    # from hanging on close/reset_session.
    pool_reset_session=False,
    **db_config
)

def get_db_connection():
    return connection_pool.get_connection()