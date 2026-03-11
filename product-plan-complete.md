# Tybre.md — 구현 완료 기능 목록

> **최종 업데이트**: 2026-03-11
> **버전**: v1.0
> **상태**: MVP 완료, P1 기능 대부분 완료

이 문서는 product-plan-v3.md에 정의된 기능 중 실제로 구현 완료된 항목들을 추적합니다.

***

## P0 (MVP 필수) — ✅ 100% 완료

### ✅ ED-001: 마크다운 실시간 변환

* Milkdown 에디터 통합 완료

* Typora 스타일 WYSIWYG 구현

* 커서 진입 시 마크다운 문법 노출

* 커서 이탈 시 150ms 전환으로 렌더링 복귀

* GFM 전체 지원 (헤딩, 볼드, 이탤릭, 링크, 이미지, 인용, 체크박스 등)

**구현 위치**:

* `src/editor/MilkdownEditor.tsx`

* `src/editor/shikiPlugin.ts`

### ✅ ED-002: 테이블 편집

* Typora 수준의 인라인 테이블 편집

* Tab키로 셀 이동

* 행/열 추가, 삭제

* 정렬 지원

**구현 위치**: `src/editor/MilkdownEditor.tsx` (Milkdown 플러그인)

### ✅ ED-003: 코드블록

* 언어별 신택스 하이라이팅 (Shiki)

* 인라인 코드 (`backtick`)

* 펜스드 코드블록 (\`\`\`language)

* 전용 코드 에디터 (CodeMirror)

**구현 위치**:

* `src/editor/CodeEditor.tsx`

* `src/editor/shikiPlugin.ts`

* `src/editor/shikiHighlighter.ts`

### ✅ FS-001: 파일 트리 사이드바

* 프로젝트 루트 폴더 기반

* 디렉토리 접기/펼치기

* 파일 열기, 새 파일/폴더 생성

* Cmd+B 토글

* 컨텍스트 메뉴 (우클릭)

**구현 위치**:

* `src/components/Sidebar.tsx`

* `src/components/ContextMenu.tsx`

### ✅ FS-002: 멀티 탭

* 여러 .md 파일을 탭으로 열기

* 수정 상태 표시 (●)

* 탭 닫기/순서 변경

* Cmd+T/W/Shift+T 지원

* Cmd+1\~9 탭 전환

**구현 위치**: `src/components/TabBar.tsx`

### ✅ FS-003: 빠른 파일 열기

* Cmd+P로 파일명 검색

* 퍼지 매칭

* 최근 열람 순 정렬

**구현 위치**: `src/components/QuickOpen.tsx`

### ✅ TM-001: 터미널 풀스크린 토글

* Cmd+\` 로 에디터 ↔ 터미널 전체 화면 전환

* 시스템 쉘 실행 (bash/zsh/powershell)

* 세션 유지 (전환해도 터미널 상태 보존)

* 에디터 복귀 시 파일 변경 자동 감지 및 리로드

* 터미널 폭 조절 가능

**구현 위치**:

* `src/components/TerminalView.tsx`

* `src-tauri/src/terminal.rs`

### ✅ SY-001: 자동 저장

* 타이핑 멈춘 후 1초 뒤 자동 저장

* Cmd+S도 지원

* 자동 저장 on/off 설정 가능

**구현 위치**: `src/App.tsx` (handleEditorChange, saveActiveTab)

### ✅ SY-002: 테마

* Light ("Paper") / Dark ("Ink") 기본 내장

* 시스템 설정 자동 감지

* 실시간 테마 전환

**구현 위치**:

* `src/styles/globals.css`

* `src/store/settingsStore.ts`

***

## P1 (출시 후 빠른 추가) — ✅ 80% 완료

### ✅ ED-004: 이미지 지원

* 드래그 앤 드롭 삽입

* 클립보드 붙여넣기

* 로컬 파일 참조 (상대 경로)

* 이미지 뷰어

**구현 위치**:

* `src/App.tsx` (ImageViewer)

* `src/editor/MilkdownEditor.tsx`

### ⚠️ ED-005: Mermaid 다이어그램

* 상태: 부분 구현

* 인라인 렌더링 미완료

* 포커스 시 소스 코드 노출 미완료

**TODO**: Mermaid 플러그인 통합 필요

### ✅ FS-004: 프로젝트 전체 검색

* Cmd+Shift+F

* 파일명 + 내용 검색

* 결과 목록에서 클릭으로 이동

**구현 위치**: `src/components/ProjectSearch.tsx`

### ✅ NA-001: 우측 목차

* 헤딩 기반 자동 생성

* hover 시 슬라이드 인

* 클릭으로 이동

* 현재 위치 하이라이트

**구현 위치**: `src/components/TableOfContents.tsx`

### ✅ EX-001: 내보내기

* PDF 변환

* HTML 변환

**구현 위치**: `src/components/ExportModal.tsx`

### ✅ SY-003: 설정

* 폰트 크기 (14-20px)

* 테마 선택

* 자동 저장 on/off

* 단축키 커스터마이징

* 가이드 모드

**구현 위치**: `src/components/Settings.tsx`

***

## 추가 구현 완료 기능 (계획에 없던 기능)

### ✅ 다중 프로젝트 관리

* 프로젝트 전환 (ProjectSwitcher)

* Ctrl+1\~9로 프로젝트 빠른 전환

* 최근 프로젝트 목록

**구현 위치**:

* `src/components/ProjectSwitcher.tsx`

* `src/hooks/useSwitchProject.ts`

### ✅ 세션 복원

* 앱 재시작 시 마지막 열린 탭 자동 복원

* 프로젝트별 탭 상태 저장

* 터미널 on/off 상태 프로젝트별 저장

* 마지막 활성 탭 복원

**구현 위치**: `src/App.tsx` (sessionRestoreRef)

### ✅ 파일 감시 및 자동 리로드

* fs watch로 외부 수정 감지

* 파일 변경 시 자동 리로드

* 파일/폴더 생성/삭제 시 파일 트리 자동 새로고침

* 충돌 방지 (자신이 저장한 파일은 무시)

**구현 위치**:

* `src/App.tsx` (file watcher useEffect)

* `src/components/Sidebar.tsx` (file-tree-changed listener)

* `src-tauri/src/watcher.rs` (file-changed, file-tree-changed events)

### ✅ 다국어 지원 (i18n)

* 언어 선택 모달

* 영어, 한국어 지원

* 실시간 언어 전환

**구현 위치**:

* `src/components/LanguageModal.tsx`

* `src/i18n/`

### ✅ 파일 타입별 뷰어

* PDF 뷰어 (iframe 기반)

* 이미지 뷰어

* 텍스트 뷰어

* 코드 에디터 (다양한 언어 지원)

**구현 위치**: `src/App.tsx` (ImageViewer, PdfViewer, TxtViewer)

### ✅ 문서 내 검색

* Cmd+F로 검색바 열기

* 검색 결과 하이라이트

* 이전/다음 결과 이동

* 대소문자 구분 옵션

**구현 위치**: `src/components/FindBar.tsx`

### ✅ 상태바

* 단어 수 (words)

* 문자 수 (chars)

* 현재 라인 번호 (ln)

**구현 위치**: `src/components/StatusBar.tsx`

### ✅ 파일 연결

* .md 파일 더블클릭 시 Tybre로 열기

* macOS/Windows 기본 앱 등록

* 이미 실행 중일 때 파일 열기 이벤트 처리

**구현 위치**:

* `src-tauri/tauri.conf.json` (fileAssociations)

* `src/App.tsx` (open-files event listener)

### ✅ 슬래시 커맨드

* `/` 입력 시 명령어 팔레트 표시

* 다양한 마크다운 요소 빠른 삽입

**구현 위치**: `src/editor/SlashCommand.tsx`

### ✅ 컨텍스트 메뉴

* 파일/폴더 우클릭 메뉴

* 새 파일/폴더 생성

* 이름 변경

* 삭제

* 경로 복사

**구현 위치**: `src/components/ContextMenu.tsx`

### ✅ 파일 미리보기

* hover 시 파일 내용 미리보기

* 이미지 미리보기

**구현 위치**: `src/components/FilePreviewPopup.tsx`

### ✅ Claude CLI 통합

* Claude CLI 설치 여부 확인

* 설치 안내 배너

* 터미널에서 직접 설치 명령 실행

**구현 위치**: `src/App.tsx` (claudeInstalled state)

### ✅ 앱 자동 업데이트

* 업데이트 확인

* 다운로드 진행률 표시

* 원클릭 설치 및 재시작

**구현 위치**: `src/App.tsx` (updateInfo, updatePhase)

***

## P2 (Phase 2 — Claude Code 특화) — ⚠️ 미구현

### ❌ CC-001: CLAUDE.md 전용 모드

* 상태: 미구현

* 필요 작업: CLAUDE.md 파일 감지 및 전용 UI

### ❌ CC-002: 에이전트 산출물 감지

* 상태: 부분 구현 (파일 감시는 완료)

* 필요 작업: diff 뷰어

### ❌ CC-003: 슬래시 커맨드 에디터

* 상태: 미구현

* 필요 작업: `.claude/commands/` 폴더 GUI 편집기

***

## P3 (Phase 3 — 생태계) — ❌ 미구현

### ❌ CL-001: .tybre 프로젝트 파일

* 상태: 미구현

### ❌ CL-002: Tybre Cloud

* 상태: 미구현

***

## 구현 통계

### 전체 완료율

* **P0 (MVP)**: 8/8 = 100% ✅

* **P1**: 5/6 = 83% ✅

* **P2**: 0/3 = 0% ❌

* **P3**: 0/2 = 0% ❌

* **추가 기능**: 14개 완료 ✅

### 핵심 기능 상태

| 카테고리   | 완료     | 진행중   | 미구현   |
| ------ | ------ | ----- | ----- |
| 에디터    | 3      | 1     | 0     |
| 파일 시스템 | 3      | 0     | 0     |
| 터미널    | 1      | 0     | 0     |
| 시스템    | 2      | 0     | 0     |
| 추가 기능  | 14     | 0     | 0     |
| **합계** | **23** | **1** | **5** |

***

## 다음 구현 우선순위

### 높음 (High Priority)

1. **ED-005: Mermaid 다이어그램** - 개발자 문서 작성에 필수
2. **CC-002: diff 뷰어** - 에이전트 협업 핵심 기능

### 중간 (Medium Priority)

1. **CC-001: CLAUDE.md 전용 모드** - Claude Code 사용자 특화
2. **CC-003: 슬래시 커맨드 에디터** - 생산성 향상

### 낮음 (Low Priority)

1. **CL-001: .tybre 프로젝트 파일** - Phase 3 생태계 구축
2. **CL-002: Tybre Cloud** - 별도 서비스

***

## 업데이트 이력

### 2026-03-11 (2차 업데이트)

* **파일 트리 자동 새로고침 개선** - 파일 생성/삭제 시 Explorer 자동 갱신

* `file-tree-changed` 이벤트 추가 (백엔드)

* Sidebar에서 파일 트리 자동 새로고침 로직 추가 (프론트엔드)

### 2026-03-11

* 초기 문서 생성

* P0, P1 기능 완료 현황 작성

* 추가 구현 완료 기능 14개 문서화

* Serena 프로젝트 메모리에 등록

***

## 참고 문서

* [product-plan-v3.md](./product-plan-v3.md) - 전체 제품 기획서

* [README.md](./README.md) - 프로젝트 개요 및 설치 가이드
