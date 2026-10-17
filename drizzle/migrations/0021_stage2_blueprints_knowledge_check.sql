ALTER TABLE public.knowledge_identity_reviews DROP CONSTRAINT IF EXISTS knowledge_identity_reviews_reason_check;
ALTER TABLE public.knowledge_identity_reviews ADD CONSTRAINT knowledge_identity_reviews_reason_check CHECK (reason = ANY (ARRAY['ambiguous','no_identity','knowledge_check']));
ALTER TABLE public.book_progressive_plans DROP CONSTRAINT IF EXISTS book_progressive_plans_plan_level_check;
ALTER TABLE public.book_progressive_plans ADD CONSTRAINT book_progressive_plans_plan_level_check CHECK (plan_level = ANY (ARRAY['CHAPTER','SECTION','BEATS','BLUEPRINT']));
ALTER TABLE public.book_progressive_plans DROP CONSTRAINT IF EXISTS book_progressive_plans_check;
ALTER TABLE public.book_progressive_plans ADD CONSTRAINT book_progressive_plans_check CHECK (((plan_level IN ('CHAPTER','BLUEPRINT')) AND subsection_index IS NULL) OR ((plan_level NOT IN ('CHAPTER','BLUEPRINT')) AND subsection_index IS NOT NULL));