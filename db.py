import mysql.connector
import os
from mysql.connector import pooling

db_config = {
    "host": os.environ.get("DB_HOST"),
    "user": os.environ.get("DB_USER"),
    "password": os.environ.get("DB_PASSWORD"),
    "database": os.environ.get("DB_NAME"),
    "port": int(os.environ.get("DB_PORT", 3306)),
    "ssl_disabled": False
}

connection_pool = pooling.MySQLConnectionPool(
    pool_name="stockwise_pool",
    pool_size=5,
    **db_config
)

def get_db_connection():
    return connection_pool.get_connection()