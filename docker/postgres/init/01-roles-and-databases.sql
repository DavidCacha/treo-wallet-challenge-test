-- Se ejecuta una sola vez al crear el volumen de PostgreSQL (docker compose)
-- o manualmente con un superusuario: psql -U postgres -f docker/postgres/init/01-roles-and-databases.sql
-- Contraseñas SOLO para desarrollo local.

-- treo_owner: dueño del esquema; corre migraciones y es dueño de las funciones SECURITY DEFINER.
CREATE ROLE treo_owner LOGIN PASSWORD 'treo_owner_dev';
-- treo_app: rol de la API en tiempo de ejecución; los permisos los otorgan las migraciones.
CREATE ROLE treo_app LOGIN PASSWORD 'treo_app_dev';

CREATE DATABASE treo OWNER treo_owner;
CREATE DATABASE treo_test OWNER treo_owner;

REVOKE ALL ON DATABASE treo FROM PUBLIC;
REVOKE ALL ON DATABASE treo_test FROM PUBLIC;
GRANT CONNECT ON DATABASE treo TO treo_owner, treo_app;
GRANT CONNECT ON DATABASE treo_test TO treo_owner, treo_app;
