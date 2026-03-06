# Tybre.md

Tauri v2 + React 19 WYSIWYG Markdown editor.

## 개발

```bash
npm run dev          # 브라우저 개발 서버 (port 1420)
npm run tauri dev    # 네이티브 앱 실행
```

## 릴리즈

> **git push는 명시적으로 요청할 때만 수행.** 개발 단계에서는 로컬 커밋만 유지.

### 사전 준비 (최초 1회)

GitHub → Settings → Secrets and variables → Actions에 다음 두 Secret 등록:

| Secret 이름 | 값 |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | `/Users/robert/Develop/dev2026/tybre-md-release/tybre-md.key` 파일 전체 내용 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `tybremd20261!` |

### 릴리즈 절차

1. **버전 올리기** — 세 파일 모두 동일 버전으로 수정:
   - `package.json` → `"version"`
   - `src-tauri/Cargo.toml` → `version`
   - `src-tauri/tauri.conf.json` → `"version"`

2. **커밋 & 태그 & 푸시**:
   ```bash
   git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
   git commit -m "chore: bump version to v1.0.0"
   git tag v1.0.0
   git push origin master --tags
   ```

3. GitHub Actions가 자동으로 macOS(arm64 + x86_64) · Ubuntu · Windows 빌드 후 **Draft Release** 생성.

4. GitHub → Releases → Draft 확인 → 릴리즈 노트 작성 → **Publish release**.

### 로컬 서명 빌드 (GitHub 없이)

```bash
TAURI_SIGNING_PRIVATE_KEY_PATH=/Users/robert/Develop/dev2026/tybre-md-release/tybre-md.key \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="tybremd20261!" \
  npm run tauri:build
```

> 키 파일 및 상세 가이드: `/Users/robert/Develop/dev2026/tybre-md-release/RELEASE.md`
