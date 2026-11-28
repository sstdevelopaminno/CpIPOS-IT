-- Explicit opt-in; existing news stays private. Public projection contains no tenant/user metadata.
ALTER TABLE public.platform_news_posts ADD COLUMN IF NOT EXISTS publish_company_web boolean NOT NULL DEFAULT false;
ALTER TABLE public.platform_news_posts ADD COLUMN IF NOT EXISTS public_category text NOT NULL DEFAULT 'general' CHECK (public_category IN ('general','update','maintenance','security'));
ALTER TABLE public.platform_news_posts ADD CONSTRAINT platform_news_company_global_only CHECK (NOT publish_company_web OR target_tenant_id IS NULL);
CREATE TABLE public.public_platform_news (
  id uuid PRIMARY KEY REFERENCES public.platform_news_posts(id) ON DELETE CASCADE,
  title text NOT NULL, body text NOT NULL,
  category text NOT NULL CHECK (category IN ('general','update','maintenance','security')),
  published_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
ALTER TABLE public.public_platform_news ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_platform_news FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_platform_news TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_platform_news TO service_role;
CREATE POLICY public_platform_news_live_read ON public.public_platform_news FOR SELECT TO anon, authenticated USING (published_at <= now());
CREATE INDEX public_platform_news_published_idx ON public.public_platform_news(published_at DESC, id DESC);
-- Invoker trigger: the authorized server role writes both tables in one transaction. No elevated callable RPC.
CREATE FUNCTION public.sync_public_platform_news() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.publish_company_web AND NEW.target_tenant_id IS NULL AND NEW.status = 'published' AND NEW.published_at IS NOT NULL THEN
    INSERT INTO public.public_platform_news(id,title,body,category,published_at,updated_at)
      VALUES (NEW.id,NEW.title,NEW.body,NEW.public_category,NEW.published_at,NEW.updated_at)
      ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,body=EXCLUDED.body,category=EXCLUDED.category,published_at=EXCLUDED.published_at,updated_at=EXCLUDED.updated_at;
  ELSE
    DELETE FROM public.public_platform_news WHERE id=NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_public_platform_news() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_public_platform_news() TO service_role;
CREATE TRIGGER sync_public_platform_news_after_write AFTER INSERT OR UPDATE ON public.platform_news_posts FOR EACH ROW EXECUTE FUNCTION public.sync_public_platform_news();
