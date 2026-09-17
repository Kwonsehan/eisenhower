-- ============================================================
-- 003_add_subtasks_to_tasks.sql
-- 아이젠하워 매트릭스 앱 - 미니 체크리스트(하위 세부 단계) 컬럼 추가
--
-- 실행 방법:
-- Supabase 대시보드 → SQL Editor → 이 내용 전체 붙여넣기 → Run
-- ============================================================

-- 1. tasks 테이블에 subtasks (JSONB 타입) 컬럼 추가
-- 기본값은 빈 배열 '[]'::jsonb 로 설정하여 기존 데이터와의 호환성을 유지합니다.
ALTER TABLE public.tasks 
ADD COLUMN IF NOT EXISTS subtasks JSONB DEFAULT '[]'::jsonb;

-- 2. 컬럼 설명 추가 (코멘트)
COMMENT ON COLUMN public.tasks.subtasks IS '할 일의 세부 실행 단계 목록 (미니 체크리스트 JSON 배열)';
