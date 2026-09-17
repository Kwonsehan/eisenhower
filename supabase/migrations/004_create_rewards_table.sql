-- ============================================================
-- 004_create_rewards_table.sql
-- 아이젠하워 매트릭스 앱 - 나에게 주는 선물 & 노는 계획 (Play & Reward Lounge) 테이블 생성
--
-- 실행 방법:
-- Supabase 대시보드 → SQL Editor → 이 내용 전체 붙여넣기 → Run
-- ============================================================

-- 1. rewards 테이블 생성
CREATE TABLE IF NOT EXISTS public.rewards (
  id           UUID PRIMARY KEY,
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title        TEXT NOT NULL,                          -- 선물/놀기 제목
  condition    TEXT DEFAULT '',                        -- 보상 해금 조건 (예: Q1 3개 완료 시)
  target_date  DATE,                                   -- 즐길 날짜 (선택)
  completed    BOOLEAN NOT NULL DEFAULT FALSE,         -- 즐기기 완료 여부
  completed_at TIMESTAMPTZ,                            -- 즐긴 시각
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()      -- 생성 시각
);

-- 2. Row Level Security (RLS) 활성화
ALTER TABLE public.rewards ENABLE ROW LEVEL SECURITY;

-- 3. RLS 정책: 본인 데이터만 CRUD 가능
CREATE POLICY "본인 선물 조회" ON public.rewards FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "본인 선물 추가" ON public.rewards FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "본인 선물 수정" ON public.rewards FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "본인 선물 삭제" ON public.rewards FOR DELETE USING (auth.uid() = user_id);

-- 4. 인덱스 생성
CREATE INDEX IF NOT EXISTS rewards_user_id_idx ON public.rewards(user_id);
CREATE INDEX IF NOT EXISTS rewards_completed_idx ON public.rewards(user_id, completed);
