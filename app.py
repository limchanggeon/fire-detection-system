import os
import cv2
import numpy as np
import torch
from flask import Flask, request, render_template, jsonify, redirect, url_for, Response
from werkzeug.utils import secure_filename
from ultralytics import YOLO
import time
from collections import deque
from datetime import datetime
import json
import threading
import base64

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
app.config['UPLOAD_FOLDER'] = 'uploads'

# 허용된 파일 확장자
ALLOWED_EXTENSIONS = {'mp4', 'avi', 'mov', 'wmv', 'flv', 'webm'}

# 전역 변수들
model = None
area_accumulator = deque(maxlen=10)  # 10초간의 면적 데이터 저장 (1초당 1프레임 가정)
smoke_grades = {
    'light': 0,
    'moderate': 1, 
    'heavy': 2,
    'critical': 3
}

# 클래스 라벨 매핑 (모델에 따라 수정 필요)
class_labels = {
    0: "smoke",
    1: "fire"
}

# 클래스별 색상 매핑
class_colors = {
    1: (0, 0, 255),    # Fire - 빨간색
    0: (128, 128, 128) # Smoke - 회색
}

# 실시간 탐지 관련 변수들
camera = None
camera_running = False
current_frame = None
current_detections = []
realtime_stats = {
    'frame_count': 0,
    'detection_count': 0,
    'current_grade': 'light',
    'last_update': time.time()
}

def allowed_file(filename):
    """허용된 파일 확장자인지 확인"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def get_class_info():
    """모델의 클래스 정보 조회"""
    global model
    if model is not None and hasattr(model, 'names'):
        # YOLO 모델에서 클래스 이름 자동 추출
        model_classes = model.names
        print(f"모델 클래스 정보: {model_classes}")
        
        # 동적으로 클래스 라벨 업데이트
        global class_labels
        class_labels = {i: name for i, name in model_classes.items()}
        
        return model_classes
    return class_labels

def load_model():
    """YOLO 모델 로드"""
    global model
    try:
        model = YOLO('best.pt')
        print("모델이 성공적으로 로드되었습니다.")
        
        # 클래스 정보 조회 및 출력
        class_info = get_class_info()
        print(f"사용 가능한 클래스: {class_info}")
        
        return True
    except Exception as e:
        print(f"모델 로드 실패: {e}")
        return False

def calculate_area_accumulation(detections, frame_width, frame_height):
    """10초간 면적 누적 계산"""
    total_area = 0
    
    for detection in detections:
        # 바운딩 박스 좌표 추출
        x1, y1, x2, y2 = detection[:4]
        
        # 면적 계산 (픽셀 단위)
        area = (x2 - x1) * (y2 - y1)
        total_area += area
    
    # 전체 프레임 대비 비율로 변환
    frame_area = frame_width * frame_height
    area_ratio = total_area / frame_area if frame_area > 0 else 0
    
    # 면적 누적기에 추가
    area_accumulator.append({
        'timestamp': time.time(),
        'area_ratio': area_ratio,
        'total_area': total_area
    })
    
    return area_ratio

def classify_smoke_grade(area_ratio, confidence_scores):
    """연기 등급 분류 로직"""
    avg_confidence = np.mean(confidence_scores) if confidence_scores else 0
    
    # 면적 비율과 신뢰도를 고려한 등급 분류
    if area_ratio < 0.01 and avg_confidence < 0.5:
        return 'light', smoke_grades['light']
    elif area_ratio < 0.05 and avg_confidence < 0.7:
        return 'moderate', smoke_grades['moderate']
    elif area_ratio < 0.15 and avg_confidence < 0.85:
        return 'heavy', smoke_grades['heavy']
    else:
        return 'critical', smoke_grades['critical']

def get_area_accumulation_stats():
    """10초간 면적 누적 통계 계산"""
    if not area_accumulator:
        return {
            'avg_area_ratio': 0,
            'max_area_ratio': 0,
            'trend': 'stable',
            'data_points': 0
        }
    
    areas = [data['area_ratio'] for data in area_accumulator]
    
    # 통계 계산
    avg_area = np.mean(areas)
    max_area = np.max(areas)
    
    # 추세 분석 (최근 3개 데이터와 이전 3개 데이터 비교)
    if len(areas) >= 6:
        recent_avg = np.mean(areas[-3:])
        prev_avg = np.mean(areas[-6:-3])
        
        if recent_avg > prev_avg * 1.2:
            trend = 'increasing'
        elif recent_avg < prev_avg * 0.8:
            trend = 'decreasing'
        else:
            trend = 'stable'
    else:
        trend = 'insufficient_data'
    
    return {
        'avg_area_ratio': float(avg_area),
        'max_area_ratio': float(max_area),
        'trend': trend,
        'data_points': len(areas),
        'time_span': len(areas)  # 초 단위
    }

def process_video(video_path):
    """비디오 처리 및 화재 탐지"""
    if model is None:
        return None, "모델이 로드되지 않았습니다."
    
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return None, "비디오 파일을 열 수 없습니다."
    
    results = []
    frame_count = 0
    
    # 비디오 정보
    fps = int(cap.get(cv2.CAP_PROP_FPS))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    
    # 1초마다 프레임 처리 (FPS만큼 프레임 건너뛰기)
    frame_interval = max(1, fps)
    
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        
        # 지정된 간격으로만 프레임 처리
        if frame_count % frame_interval == 0:
            # YOLO 추론
            detection_results = model(frame)
            
            detections = []
            confidence_scores = []
            
            for result in detection_results:
                boxes = result.boxes
                if boxes is not None:
                    for box in boxes:
                        x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                        confidence = box.conf[0].cpu().numpy()
                        class_id = box.cls[0].cpu().numpy()
                        
                        detections.append([x1, y1, x2, y2, confidence, class_id])
                        confidence_scores.append(confidence)
            
            # 면적 누적 계산
            area_ratio = calculate_area_accumulation(detections, width, height)
            
            # 연기 등급 분류
            grade_name, grade_value = classify_smoke_grade(area_ratio, confidence_scores)
            
            # 결과 저장
            frame_result = {
                'frame_number': frame_count,
                'timestamp': frame_count / fps,
                'detections': len(detections),
                'area_ratio': area_ratio,
                'smoke_grade': grade_name,
                'grade_value': grade_value,
                'avg_confidence': float(np.mean(confidence_scores)) if confidence_scores else 0,
                'detection_details': detections
            }
            
            results.append(frame_result)
        
        frame_count += 1
    
    cap.release()
    
    # 전체 분석 결과
    analysis_summary = {
        'total_frames': total_frames,
        'processed_frames': len(results),
        'video_duration': total_frames / fps,
        'fps': fps,
        'resolution': {'width': width, 'height': height},
        'area_stats': get_area_accumulation_stats(),
        'max_grade': max([r['grade_value'] for r in results]) if results else 0,
        'avg_detections': float(np.mean([r['detections'] for r in results])) if results else 0
    }
    
    return {
        'frame_results': results,
        'summary': analysis_summary
    }, None

def start_camera():
    """웹캠 시작"""
    global camera, camera_running
    try:
        camera = cv2.VideoCapture(0)  # 기본 웹캠
        if not camera.isOpened():
            return False, "웹캠을 열 수 없습니다."
        
        # 웹캠 설정
        camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        camera.set(cv2.CAP_PROP_FPS, 30)
        
        camera_running = True
        return True, "웹캠이 시작되었습니다."
    except Exception as e:
        return False, f"웹캠 시작 실패: {e}"

def stop_camera():
    """웹캠 정지"""
    global camera, camera_running, current_frame, current_detections
    camera_running = False
    if camera is not None:
        camera.release()
        camera = None
    current_frame = None
    current_detections = []
    return True, "웹캠이 정지되었습니다."

def process_realtime_frame(frame):
    """실시간 프레임 처리"""
    global model, current_detections, realtime_stats
    
    if model is None:
        return frame, []
    
    try:
        # YOLO 추론
        results = model(frame, conf=0.3)  # 신뢰도 임계값 낮춤
        
        detections = []
        confidence_scores = []
        
        # 결과 처리
        for result in results:
            boxes = result.boxes
            if boxes is not None:
                for box in boxes:
                    x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                    confidence = box.conf[0].cpu().numpy()
                    class_id = int(box.cls[0].cpu().numpy())
                    
                    detections.append([x1, y1, x2, y2, confidence, class_id])
                    confidence_scores.append(confidence)
                    
                    # 클래스에 따른 라벨과 색상 선택
                    label_name = class_labels.get(class_id, f"Class_{class_id}")
                    color = class_colors.get(class_id, (0, 255, 0))  # 기본 녹색
                    
                    # 바운딩 박스 그리기
                    cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), color, 2)
                    
                    # 라벨 표시
                    label = f"{label_name}: {confidence:.2f}"
                    label_size = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)[0]
                    
                    # 라벨 배경 그리기
                    cv2.rectangle(frame, (int(x1), int(y1) - label_size[1] - 10), 
                                 (int(x1) + label_size[0], int(y1)), color, -1)
                    
                    # 라벨 텍스트 표시
                    cv2.putText(frame, label, (int(x1), int(y1) - 5), 
                              cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        
        # 면적 계산 및 등급 분류
        height, width = frame.shape[:2]
        area_ratio = calculate_area_accumulation(detections, width, height)
        grade_name, grade_value = classify_smoke_grade(area_ratio, confidence_scores)
        
        # 클래스별 카운트 계산
        fire_count = sum(1 for det in detections if int(det[5]) == 0)
        smoke_count = sum(1 for det in detections if int(det[5]) == 1)
        
        # 통계 업데이트
        realtime_stats['frame_count'] += 1
        realtime_stats['detection_count'] = len(detections)
        realtime_stats['current_grade'] = grade_name
        realtime_stats['last_update'] = time.time()
        realtime_stats['fire_count'] = fire_count
        realtime_stats['smoke_count'] = smoke_count
        
        # 현재 상태 정보 표시
        status_text = f"Grade: {grade_name.upper()} | Fire: {fire_count} | Smoke: {smoke_count} | Area: {area_ratio*100:.1f}%"
        
        # 상태 텍스트 배경 그리기
        text_size = cv2.getTextSize(status_text, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)[0]
        cv2.rectangle(frame, (5, 5), (text_size[0] + 15, text_size[1] + 15), (0, 0, 0), -1)
        
        # 상태 텍스트 표시
        cv2.putText(frame, status_text, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        
        current_detections = detections
        return frame, detections
        
    except Exception as e:
        print(f"프레임 처리 오류: {e}")
        return frame, []

def generate_frames():
    """비디오 스트림 생성"""
    global camera, camera_running, current_frame
    
    while camera_running and camera is not None:
        success, frame = camera.read()
        if not success:
            break
        
        # 프레임 처리
        processed_frame, detections = process_realtime_frame(frame)
        current_frame = processed_frame
        
        # JPEG로 인코딩
        ret, buffer = cv2.imencode('.jpg', processed_frame)
        frame = buffer.tobytes()
        
        # 스트림 형식으로 전송
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
        
        time.sleep(0.1)  # FPS 조절 (10 FPS)

@app.route('/')
def index():
    """메인 페이지"""
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_video():
    """비디오 업로드 및 처리"""
    if 'file' not in request.files:
        return jsonify({'error': '파일이 선택되지 않았습니다.'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': '파일이 선택되지 않았습니다.'}), 400
    
    if file and file.filename and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{timestamp}_{filename}"
        
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        # 비디오 처리
        results, error = process_video(filepath)
        
        if error:
            return jsonify({'error': error}), 500
        
        # 처리 완료 후 파일 삭제 (선택사항)
        # os.remove(filepath)
        
        return jsonify({
            'success': True,
            'filename': filename,
            'results': results
        })
    
    return jsonify({'error': '허용되지 않는 파일 형식입니다.'}), 400

@app.route('/stats')
def get_stats():
    """현재 통계 조회"""
    stats = get_area_accumulation_stats()
    return jsonify(stats)

@app.route('/reset')
def reset_stats():
    """통계 리셋"""
    global area_accumulator
    area_accumulator.clear()
    return jsonify({'success': True, 'message': '통계가 리셋되었습니다.'})

@app.route('/start_realtime')
def start_realtime():
    """실시간 탐지 시작"""
    success, message = start_camera()
    return jsonify({'success': success, 'message': message})

@app.route('/stop_realtime')
def stop_realtime():
    """실시간 탐지 정지"""
    success, message = stop_camera()
    return jsonify({'success': success, 'message': message})

@app.route('/video_feed')
def video_feed():
    """비디오 스트림 피드"""
    return Response(generate_frames(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/realtime_stats')
def get_realtime_stats():
    """실시간 통계 조회"""
    global realtime_stats
    area_stats = get_area_accumulation_stats()
    
    combined_stats = {
        **realtime_stats,
        **area_stats,
        'camera_running': camera_running
    }
    return jsonify(combined_stats)

@app.route('/capture_frame')
def capture_frame():
    """현재 프레임 캡처"""
    global current_frame, current_detections
    
    if current_frame is None:
        return jsonify({'error': '캡처할 프레임이 없습니다.'}), 400
    
    try:
        # 클래스별 카운트 계산
        fire_count = sum(1 for det in current_detections if int(det[5]) == 0)
        smoke_count = sum(1 for det in current_detections if int(det[5]) == 1)
        
        # 프레임을 base64로 인코딩
        ret, buffer = cv2.imencode('.jpg', current_frame)
        img_base64 = base64.b64encode(buffer).decode('utf-8')
        
        return jsonify({
            'success': True,
            'image': img_base64,
            'detections': len(current_detections),
            'fire_count': fire_count,
            'smoke_count': smoke_count,
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        return jsonify({'error': f'프레임 캡처 실패: {e}'}), 500

if __name__ == '__main__':
    # 모델 로드
    if load_model():
        print("화재 탐지 웹 애플리케이션을 시작합니다...")
        app.run(debug=True, host='0.0.0.0', port=8080)
    else:
        print("모델 로드에 실패했습니다. best.pt 파일을 확인해주세요.")
