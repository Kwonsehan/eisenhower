-- ============================================================
-- 001_create_tasks_table.sql
-- 아이젠하워 매트릭스 앱 - Supabase 테이블 생성 쿼리
--
-- 실행 방법:
-- Supabase 대시보드 → SQL Editor → 이 내용 전체 붙여넣기 → Run
-- ============================================================


-- ── tasks 테이블 생성 ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tasks (
  -- 기본 식별자
  id            UUID PRIMARY KEY,                          -- 각 할 일의 고유 ID
  user_id       UUID REFERENCES auth.users(id)            -- 어느 사용자의 할 일인지
                  ON DELETE CASCADE NOT NULL,

  -- 할 일 내용
  title         TEXT NOT NULL,                            -- 할 일 제목
  quadrant      TEXT NOT NULL                             -- 사분면 (Q1/Q2/Q3/Q4)
                  CHECK (quadrant IN ('Q1','Q2','Q3','Q4')),
  due_date      DATE,                                     -- 마감일 (선택)
  memo          TEXT DEFAULT '',                          -- 메모/설명 (선택)

  -- 완료 상태
  completed     BOOLEAN NOT NULL DEFAULT FALSE,           -- 완료 여부
  completed_at  TIMESTAMPTZ,                              -- 완료 시각

  -- 시간 정보
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),       -- 생성 시각
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()        -- 마지막 수정 시각
);


-- ── Row Level Security (RLS) 활성화 ────────────────────────
-- 내 데이터는 나만 볼 수 있게 보안 설정합니다.
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;


-- ── RLS 정책: 본인 데이터만 접근 가능 ──────────────────────
-- 조회: 내가 만든 할 일만 볼 수 있음
CREATE POLICY "본인 데이터 조회"
  ON public.tasks FOR SELECT
  USING (auth.uid() = user_id);

-- 삽입: 내 user_id로만 새 항목 추가 가능
CREATE POLICY "본인 데이터 추가"
  ON public.tasks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 수정: 내 데이터만 수정 가능
CREATE POLICY "본인 데이터 수정"
  ON public.tasks FOR UPDATE
  USING (auth.uid() = user_id);

-- 삭제: 내 데이터만 삭제 가능
CREATE POLICY "본인 데이터 삭제"
  ON public.tasks FOR DELETE
  USING (auth.uid() = user_id);


-- ── updated_at 자동 갱신 함수 ──────────────────────────────
-- 데이터가 수정될 때마다 updated_at을 현재 시각으로 자동 업데이트합니다.
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거: tasks 테이블 수정 시 자동 실행
CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();


-- ── 인덱스 (검색 성능 향상) ────────────────────────────────
CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON public.tasks(user_id);
CREATE INDEX IF NOT EXISTS tasks_quadrant_idx ON public.tasks(user_id, quadrant);
CREATE INDEX IF NOT EXISTS tasks_completed_idx ON public.tasks(user_id, completed);
