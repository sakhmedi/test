-- postgres-init/init.sql
-- Runs automatically on first startup via the postgres-init volume mount.
-- Creates additional databases required by Langfuse and n8n.

\connect postgres

SELECT 'CREATE DATABASE langfuse'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'langfuse')\gexec

