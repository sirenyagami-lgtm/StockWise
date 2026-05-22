-- StockWise consolidated full schema
-- Clean install for XAMPP/MariaDB. This file contains the current tables needed by the cleaned StockWise codebase.
-- It creates structure only. It does not insert fake sales data.
-- Canonical account roles: Owner, Store Manager, Operational Assistant.

CREATE DATABASE IF NOT EXISTS stockwise_db CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE stockwise_db;

CREATE TABLE IF NOT EXISTS users (
    user_id INT(11) NOT NULL AUTO_INCREMENT,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    position VARCHAR(100) NULL DEFAULT 'Owner',
    profile_image VARCHAR(255) NULL,
    role VARCHAR(50) NULL DEFAULT 'Owner',
    store_id INT(11) NULL,
    created_by INT(11) NULL,
    account_status VARCHAR(30) NULL DEFAULT 'active',
    username VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    last_login_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    UNIQUE KEY uq_users_email (email),
    UNIQUE KEY uq_users_username (username),
    INDEX idx_users_store_role (store_id, role),
    INDEX idx_users_status (account_status, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stores (
    store_id INT(11) NOT NULL AUTO_INCREMENT,
    owner_user_id INT(11) NOT NULL,
    store_name VARCHAR(255) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (store_id),
    INDEX idx_stores_owner (owner_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS store_memberships (
    membership_id INT(11) NOT NULL AUTO_INCREMENT,
    store_id INT(11) NOT NULL,
    user_id INT(11) NOT NULL,
    role VARCHAR(50) NOT NULL,
    account_status VARCHAR(30) NOT NULL DEFAULT 'active',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by INT(11) NULL,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    removed_at DATETIME NULL,
    reactivated_at DATETIME NULL,
    last_login_at DATETIME NULL,
    PRIMARY KEY (membership_id),
    UNIQUE KEY uq_store_user_membership (store_id, user_id),
    INDEX idx_membership_store_status (store_id, account_status),
    INDEX idx_membership_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_settings (
    setting_id INT(11) NOT NULL AUTO_INCREMENT,
    user_id INT(11) NOT NULL,
    store_name VARCHAR(255) NULL,
    store_type VARCHAR(100) NULL,
    location_area VARCHAR(255) NULL,
    store_logo VARCHAR(255) NULL,
    currency VARCHAR(20) NULL DEFAULT 'PHP',
    default_upload_mode VARCHAR(32) NULL DEFAULT 'new',
    default_time_range VARCHAR(32) NULL DEFAULT '30',
    default_product_view VARCHAR(32) NULL DEFAULT 'needs_attention',
    show_safe_products_dashboard VARCHAR(8) NULL DEFAULT 'no',
    default_report_type VARCHAR(100) NULL DEFAULT 'demand_forecast_summary',
    default_report_period VARCHAR(32) NULL DEFAULT 'last_30_days',
    export_format VARCHAR(20) NULL DEFAULT 'csv',
    include_filtered_rows_only VARCHAR(8) NULL DEFAULT 'yes',
    onboarding_completed TINYINT(1) NOT NULL DEFAULT 1,
    data_date_format VARCHAR(32) NULL DEFAULT 'auto',
    data_time_format VARCHAR(32) NULL DEFAULT 'auto',
    payday_indicator_handling VARCHAR(32) NULL DEFAULT 'auto',
    duplicate_handling VARCHAR(32) NULL DEFAULT 'remove_exact',
    column_mapping_json TEXT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (setting_id),
    UNIQUE KEY uq_user_settings_user (user_id),
    INDEX idx_user_settings_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS categories (
    category_id INT(11) NOT NULL AUTO_INCREMENT,
    category_name VARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (category_id),
    UNIQUE KEY uq_categories_name (category_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS products (
    product_id INT(11) NOT NULL AUTO_INCREMENT,
    user_id INT(11) NULL,
    category_id INT(11) NULL,
    product_name VARCHAR(255) NOT NULL,
    standard_price DECIMAL(12,4) NULL DEFAULT 0.0000,
    reorder_point INT(11) NULL DEFAULT 0,
    unit_type VARCHAR(100) NULL DEFAULT 'Unit',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (product_id),
    INDEX idx_products_user_name (user_id, product_name),
    INDEX idx_products_category (category_id),
    INDEX idx_products_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventory (
    inventory_id INT(11) NOT NULL AUTO_INCREMENT,
    product_id INT(11) NOT NULL,
    current_stock INT(11) NOT NULL DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (inventory_id),
    UNIQUE KEY uq_inventory_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS uploads (
    upload_id INT(11) NOT NULL AUTO_INCREMENT,
    user_id INT(11) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(32) NULL,
    upload_status VARCHAR(50) NOT NULL DEFAULT 'uploaded',
    row_count INT(11) NULL DEFAULT 0,
    remarks TEXT NULL,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME NULL,
    PRIMARY KEY (upload_id),
    INDEX idx_uploads_user_status (user_id, upload_status),
    INDEX idx_uploads_processed (processed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sales_transactions (
    transaction_id BIGINT NOT NULL AUTO_INCREMENT,
    upload_id INT(11) NOT NULL,
    product_id INT(11) NOT NULL,
    quantity_sold INT(11) NOT NULL DEFAULT 0,
    unit_price DECIMAL(12,4) NULL DEFAULT 0.0000,
    transaction_date DATE NOT NULL,
    transaction_time TIME NULL,
    time_of_day VARCHAR(40) NULL,
    day_of_week VARCHAR(40) NULL,
    is_payday TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (transaction_id),
    INDEX idx_sales_upload (upload_id),
    INDEX idx_sales_product_date (product_id, transaction_date),
    INDEX idx_sales_date (transaction_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventory_history (
    history_id BIGINT NOT NULL AUTO_INCREMENT,
    product_id INT(11) NOT NULL,
    upload_id INT(11) NULL,
    recorded_at DATETIME NULL,
    stock_on_hand INT(11) NULL DEFAULT 0,
    is_stockout TINYINT(1) NOT NULL DEFAULT 0,
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (history_id),
    INDEX idx_inventory_history_product_date (product_id, recorded_at),
    INDEX idx_inventory_history_upload (upload_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS model_runs (
    model_run_id INT(11) NOT NULL AUTO_INCREMENT,
    upload_id INT(11) NOT NULL,
    user_id INT(11) NOT NULL,
    run_status VARCHAR(32) DEFAULT 'started',
    sarima_status VARCHAR(32) DEFAULT 'pending',
    xgboost_status VARCHAR(32) DEFAULT 'pending',
    sarima_version VARCHAR(100) NULL,
    xgboost_version VARCHAR(100) NULL,
    notes TEXT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME NULL,
    PRIMARY KEY (model_run_id),
    INDEX idx_model_runs_user_upload (user_id, upload_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS forecasts (
    forecast_id BIGINT NOT NULL AUTO_INCREMENT,
    model_run_id INT(11) NOT NULL,
    upload_id INT(11) NULL,
    user_id INT(11) NULL,
    product_id INT(11) NULL,
    product_name VARCHAR(255) NOT NULL,
    forecast_date DATE NULL,
    horizon_days INT(11) NULL,
    forecast_quantity DECIMAL(12,4) NULL,
    model_source VARCHAR(32) NULL DEFAULT 'SARIMA',
    status_label VARCHAR(32) NULL DEFAULT 'completed',
    note TEXT NULL,
    generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (forecast_id),
    INDEX idx_forecasts_lookup (user_id, upload_id, product_name, horizon_days)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stockout_predictions (
    prediction_id BIGINT NOT NULL AUTO_INCREMENT,
    model_run_id INT(11) NOT NULL,
    upload_id INT(11) NULL,
    user_id INT(11) NULL,
    product_id INT(11) NULL,
    product_name VARCHAR(255) NOT NULL,
    prediction_date DATE NULL,
    forecast_horizon_days INT(11) NULL,
    stockout_probability DECIMAL(10,6) NULL,
    risk_level VARCHAR(32) NULL DEFAULT 'Unavailable',
    model_source VARCHAR(32) NULL DEFAULT 'XGBoost',
    top_factors TEXT NULL,
    note TEXT NULL,
    recommendation VARCHAR(255) NULL,
    generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (prediction_id),
    INDEX idx_predictions_lookup (user_id, upload_id, product_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notifications (
    notification_id INT(11) NOT NULL AUTO_INCREMENT,
    user_id INT(11) NOT NULL,
    store_id INT(11) NULL,
    title VARCHAR(120) NOT NULL,
    message VARCHAR(255) NOT NULL,
    event_type VARCHAR(50) NULL DEFAULT 'system',
    target_role VARCHAR(40) NULL,
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (notification_id),
    INDEX idx_notifications_user_created (user_id, created_at),
    INDEX idx_notifications_user_read (user_id, is_read),
    INDEX idx_notifications_store_created (store_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS activity_logs (
    log_id INT(11) NOT NULL AUTO_INCREMENT,
    store_id INT(11) NULL,
    user_id INT(11) NULL,
    membership_id INT(11) NULL,
    user_name VARCHAR(255) NULL,
    actor_role VARCHAR(50) NULL,
    action VARCHAR(120) NOT NULL,
    module VARCHAR(80) NOT NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'Success',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (log_id),
    INDEX idx_activity_store_created (store_id, created_at),
    INDEX idx_activity_user_created (user_id, created_at),
    INDEX idx_activity_membership_created (membership_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
