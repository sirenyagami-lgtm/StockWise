import mysql.connector
from mysql.connector import pooling

db_config = {
    "host": "localhost",
    "user": "root",
    "password": "",
    "database": "stockwise_db",
    "port": 3306,
}

connection_pool = pooling.MySQLConnectionPool(
    pool_name="stockwise_pool",
    pool_size=5,
    **db_config
)

def get_db_connection():
    return connection_pool.get_connection()