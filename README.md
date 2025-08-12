# 화재 탐지 시스템

AI 기반 실시간 화재 및 연기 탐지 웹 애플리케이션입니다.

## 주요 기능

### 1. 실시간 화재 탐지 🎥
- 웹캠을 통한 실시간 영상 스트리밍
- 실시간 화재/연기 탐지 및 바운딩 박스 표시
- 실시간 위험도 등급 분류 및 표시
- 프레임 캡처 기능 (탐지 결과 저장)
- 1초마다 통계 업데이트

### 2. 10초간 면적 누적 계산 알고리즘
- 탐지된 화재/연기 영역의 면적을 실시간으로 계산
- 10초간의 데이터를 누적하여 추세 분석
- 전체 프레임 대비 화재 영역 비율 계산

### 3. 연기 등급 분류 로직
- **경미 (Light)**: 면적 비율 < 1%, 신뢰도 < 50%
- **보통 (Moderate)**: 면적 비율 < 5%, 신뢰도 < 70%
- **심각 (Heavy)**: 면적 비율 < 15%, 신뢰도 < 85%
- **위험 (Critical)**: 그 이상의 경우

### 4. 웹 프론트엔드 기능
- 직관적인 사용자 인터페이스
- 실시간 통계 대시보드
- 차트를 통한 데이터 시각화
- 반응형 디자인 (모바일 친화적)

### 5. 영상 업로드 기능
- 드래그 앤 드롭 지원
- 다양한 비디오 형식 지원 (MP4, AVI, MOV, WMV, FLV, WEBM)
- 실시간 업로드 진행률 표시
- 파일 크기 제한 (최대 16MB)

## 설치 및 실행

### 1. 환경 설정
```bash
# 가상환경 생성 (이미 생성됨)
python -m venv .venv

# 가상환경 활성화
source .venv/bin/activate  # macOS/Linux
# 또는
.venv\Scripts\activate  # Windows

# 패키지 설치
pip install -r requirements.txt
```

### 2. 실행
```bash
python app.py
```

웹 브라우저에서 `http://localhost:5000` 접속

### 3. 애플리케이션 종료 방법

#### 방법 1: 키보드 단축키 (가장 간단)
터미널에서 실행 중일 때:
```bash
Ctrl + C  # macOS/Linux
Cmd + C   # macOS (선택사항)
```

#### 방법 2: 프로세스 강제 종료
```bash
# Python 프로세스 종료
pkill -f "python app.py"
```

#### 방법 3: 특정 포트 프로세스 종료
```bash
# 5000 포트 사용 프로세스 종료
lsof -ti:5000 | xargs kill
```

#### 종료 확인
```bash
# 실행 중인 Python 프로세스 확인
ps aux | grep python
```

## 프로젝트 구조

```
lastec/
├── app.py              # 메인 Flask 애플리케이션
├── best.pt             # 학습된 YOLO 모델
├── requirements.txt    # Python 패키지 의존성
├── README.md          # 프로젝트 설명
├── static/
│   ├── css/
│   │   └── style.css  # 스타일시트
│   └── js/
│       └── main.js    # JavaScript 로직
├── templates/
│   └── index.html     # 메인 HTML 템플릿
└── uploads/           # 업로드된 파일 저장 디렉토리
```

## API 엔드포인트

### 기본 페이지
- `GET /`: 메인 페이지

### 파일 업로드
- `POST /upload`: 비디오 업로드 및 분석

### 통계 관리
- `GET /stats`: 현재 통계 조회
- `GET /reset`: 통계 리셋

### 실시간 탐지
- `GET /start_realtime`: 실시간 탐지 시작
- `GET /stop_realtime`: 실시간 탐지 정지
- `GET /video_feed`: 비디오 스트림 피드
- `GET /realtime_stats`: 실시간 통계 조회
- `GET /capture_frame`: 현재 프레임 캡처

## 기술 스택

- **백엔드**: Flask, PyTorch, OpenCV, Ultralytics YOLO
- **프론트엔드**: HTML5, CSS3, JavaScript, Chart.js
- **AI 모델**: YOLO v8 (best.pt)

## 사용법

### 실시간 탐지
1. 웹 애플리케이션 실행
2. "실시간 화재 탐지" 섹션에서 "실시간 탐지 시작" 버튼 클릭
3. 웹캠 권한 허용
4. 실시간으로 화재 탐지 결과 확인
5. 필요시 "프레임 캡처" 버튼으로 현재 화면 저장
6. "실시간 탐지 정지" 버튼으로 종료

### 파일 업로드 분석
1. "영상 업로드" 섹션에서 비디오 파일 업로드
2. 자동으로 분석 진행
3. 분석 결과 및 차트 확인
4. 통계 대시보드에서 누적 데이터 모니터링

## 주의사항

- 모델 파일 `best.pt`가 프로젝트 루트 디렉토리에 있어야 합니다.
- 업로드 파일 크기는 최대 16MB로 제한됩니다.
- GPU가 있는 경우 더 빠른 처리가 가능합니다.
- 실시간 탐지 기능을 사용하려면 웹캠이 연결되어 있어야 합니다.
- 브라우저에서 웹캠 권한을 허용해야 합니다.
- 실시간 탐지는 CPU 사용량이 높을 수 있습니다.

## 문제 해결

### 포트 충돌 오류
```bash
# 이미 사용 중인 포트 확인
lsof -i :5000

# 포트 사용 프로세스 종료
lsof -ti:5000 | xargs kill
```

### 가상환경 활성화 문제
```bash
# 가상환경 재생성
rm -rf .venv
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 웹캠 접근 권한 문제
- 브라우저 설정에서 카메라 권한 허용
- macOS의 경우 시스템 환경설정 > 보안 및 개인정보보호 > 카메라에서 브라우저 허용

### 모델 로딩 오류
- `best.pt` 파일이 프로젝트 루트에 있는지 확인
- PyTorch 및 Ultralytics 패키지 버전 확인

### 메모리 부족 오류
- 실시간 탐지 시 다른 프로그램 종료
- 비디오 해상도나 처리 속도 조정 고려

## 개발자 정보

### 프로젝트 상태 모니터링
```bash
# Flask 애플리케이션 로그 실시간 확인
python app.py

# 시스템 리소스 사용량 확인
top -p $(pgrep -f "python app.py")
```

### 개발 모드 실행
```bash
# 디버그 모드로 실행 (코드 변경 시 자동 재시작)
export FLASK_ENV=development
export FLASK_DEBUG=1
python app.py
```

### 코드 구조
- `app.py`: 메인 Flask 애플리케이션, API 엔드포인트, YOLO 모델 통합
- `templates/index.html`: 메인 UI 템플릿
- `static/js/main.js`: 프론트엔드 로직, AJAX 통신
- `static/css/style.css`: 스타일링, 반응형 디자인

## 라이선스

이 프로젝트는 교육 및 연구 목적으로 개발되었습니다.
