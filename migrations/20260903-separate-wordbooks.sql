BEGIN;
-- Run once as project administrator. Backup is private, not exposed via REST.
CREATE SCHEMA IF NOT EXISTS wordbook_archive;
REVOKE ALL ON SCHEMA wordbook_archive FROM PUBLIC, anon, authenticated;
CREATE TABLE wordbook_archive.before_split_20260903 AS
SELECT * FROM public.user_data WHERE user_id IN
('3ff1ca0c-acfa-4698-95b5-5573890b5292','b39fdeec-0b83-4f05-a9e5-5f2375bb8440');
DO $$ BEGIN
 IF (SELECT count(*) FROM wordbook_archive.before_split_20260903) <> 2
 THEN RAISE EXCEPTION 'Expected both existing account records; migration aborted'; END IF;
END $$;
REVOKE ALL ON wordbook_archive.before_split_20260903 FROM PUBLIC, anon, authenticated;
ALTER TABLE wordbook_archive.before_split_20260903 ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.wordbook_steven (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
 CHECK (user_id='3ff1ca0c-acfa-4698-95b5-5573890b5292'),
 base_words jsonb, custom_words jsonb NOT NULL DEFAULT '[]',
 progress jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.wordbook_zeran (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
 CHECK (user_id='b39fdeec-0b83-4f05-a9e5-5f2375bb8440'),
 base_words jsonb NOT NULL DEFAULT '[]', custom_words jsonb NOT NULL DEFAULT '[]',
 progress jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wordbook_steven ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wordbook_zeran ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wordbook_steven, public.wordbook_zeran FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.wordbook_steven, public.wordbook_zeran TO authenticated;
CREATE POLICY own_wordbook ON public.wordbook_steven FOR ALL TO authenticated
 USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY own_wordbook ON public.wordbook_zeran FOR ALL TO authenticated
 USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
INSERT INTO public.wordbook_steven(user_id,custom_words,progress,updated_at)
SELECT user_id,custom_words,progress,updated_at FROM public.user_data
WHERE user_id='3ff1ca0c-acfa-4698-95b5-5573890b5292';
INSERT INTO public.wordbook_zeran(user_id)
VALUES ('b39fdeec-0b83-4f05-a9e5-5f2375bb8440');
UPDATE public.user_data SET progress='{}',custom_words='[]',updated_at=now()
WHERE user_id='b39fdeec-0b83-4f05-a9e5-5f2375bb8440';
-- Old clients must refresh instead of restoring deleted records to the old table.
CREATE FUNCTION public.reject_legacy_wordbook_save() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF current_user IN ('authenticated','anon') AND NEW.user_id IN
 ('3ff1ca0c-acfa-4698-95b5-5573890b5292','b39fdeec-0b83-4f05-a9e5-5f2375bb8440') THEN
 RAISE EXCEPTION 'Wordbook upgraded. Refresh the app and sign in again.';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reject_legacy_wordbook_save BEFORE INSERT OR UPDATE ON public.user_data
FOR EACH ROW EXECUTE FUNCTION public.reject_legacy_wordbook_save();
COMMIT;
