-- ============================================================
-- 002_add_scheduled_date_to_tasks.sql
-- 아이젠하워 매트릭스 앱 - 실행 예정일(scheduled_date) 컬럼 추가
-- 
-- 역할:
-- 마감일(due_date)과 별개로, 캘린더에 드래그하여 배정한
-- "내가 이 작업을 실행하기로 계획한 날(scheduled_date)"을 저장합니다.
-- ============================================================

-- 1. tasks 테이블에 scheduled_date (DATE 타입) 컬럼 추가
ALTER TABLE public.tasks 
ADD COLUMN IF NOT EXISTS scheduled_date DATE;

-- 2. 날짜별 캘린더 조회 성능 향상을 위한 복합 인덱스 생성
CREATE INDEX IF NOT EXISTS tasks_scheduled_date_idx 
ON public.tasks(user_id, scheduled_date);
