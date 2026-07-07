#!/bin/sh
# Runs once on first container init: create the test database alongside the dev one.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE gitrank_test;
    GRANT ALL PRIVILEGES ON DATABASE gitrank_test TO $POSTGRES_USER;
EOSQL
