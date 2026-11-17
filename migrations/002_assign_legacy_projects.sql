-- OPCIONAL: executar DESPRES de registrar el teu primer usuari.
-- CANVIA 'el-teu-correu@exemple.com' pel teu correu real abans d'executar-lo.
-- Aquest script assigna NOMES projectes antics sense propietari.
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE email = 'el-teu-correu@exemple.com') THEN
        RAISE EXCEPTION 'No existeix aquest usuari. Canvia el correu al fitxer.';
    END IF;
END $$;

UPDATE projects
SET owner_id = (SELECT id FROM users WHERE email = 'el-teu-correu@exemple.com')
WHERE owner_id IS NULL;

INSERT INTO project_members (project_id, user_id, role)
SELECT p.id, p.owner_id, 'owner'
FROM projects p
WHERE p.owner_id = (SELECT id FROM users WHERE email = 'el-teu-correu@exemple.com')
ON CONFLICT (project_id, user_id) DO NOTHING;
COMMIT;
