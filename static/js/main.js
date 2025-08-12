// 전역 변수
let analysisChart = null;
let statsUpdateInterval = null;
let realtimeStatsInterval = null;
let isRealtimeActive = false;

// DOM이 로드되면 초기화
document.addEventListener('DOMContentLoaded', function() {
    initializeUpload();
    startStatsUpdate();
});

// 파일 업로드 초기화
function initializeUpload() {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');

    // 클릭 이벤트
    uploadArea.addEventListener('click', () => {
        fileInput.click();
    });

    // 드래그 앤 드롭 이벤트
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFileUpload(files[0]);
        }
    });

    // 파일 선택 이벤트
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileUpload(e.target.files[0]);
        }
    });
}

// 파일 업로드 처리
function handleFileUpload(file) {
    // 파일 유효성 검사
    const allowedTypes = ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/x-flv', 'video/webm'];
    if (!allowedTypes.includes(file.type)) {
        showNotification('지원되지 않는 파일 형식입니다.', 'error');
        return;
    }

    if (file.size > 16 * 1024 * 1024) { // 16MB
        showNotification('파일 크기가 너무 큽니다. (최대 16MB)', 'error');
        return;
    }

    // 업로드 진행률 표시
    const uploadProgress = document.getElementById('uploadProgress');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    
    uploadProgress.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = '업로드 중...';

    // FormData 생성
    const formData = new FormData();
    formData.append('file', file);

    // XMLHttpRequest로 업로드 (진행률 추적 가능)
    const xhr = new XMLHttpRequest();

    // 진행률 이벤트
    xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
            const percentComplete = (e.loaded / e.total) * 100;
            progressFill.style.width = percentComplete + '%';
            progressText.textContent = `업로드 중... ${Math.round(percentComplete)}%`;
        }
    });

    // 완료 이벤트
    xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
            progressText.textContent = '분석 중...';
            progressFill.style.width = '100%';
            
            try {
                const response = JSON.parse(xhr.responseText);
                if (response.success) {
                    showNotification('영상 분석이 완료되었습니다!', 'success');
                    displayResults(response.results);
                } else {
                    showNotification(response.error || '분석 중 오류가 발생했습니다.', 'error');
                }
            } catch (e) {
                showNotification('응답 처리 중 오류가 발생했습니다.', 'error');
            }
        } else {
            showNotification('업로드 중 오류가 발생했습니다.', 'error');
        }
        
        // 진행률 숨기기
        setTimeout(() => {
            uploadProgress.style.display = 'none';
        }, 2000);
    });

    // 오류 이벤트
    xhr.addEventListener('error', () => {
        showNotification('네트워크 오류가 발생했습니다.', 'error');
        uploadProgress.style.display = 'none';
    });

    // 요청 전송
    xhr.open('POST', '/upload');
    xhr.send(formData);
}

// 결과 표시
function displayResults(results) {
    const resultsSection = document.getElementById('resultsSection');
    const resultSummary = document.getElementById('resultSummary');
    const frameResults = document.getElementById('frameResults');

    resultsSection.style.display = 'block';

    // 요약 정보 표시
    const summary = results.summary;
    resultSummary.innerHTML = `
        <h3>분석 요약</h3>
        <div class="summary-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 15px;">
            <div class="summary-item">
                <strong>총 프레임:</strong> ${summary.total_frames.toLocaleString()}
            </div>
            <div class="summary-item">
                <strong>처리된 프레임:</strong> ${summary.processed_frames.toLocaleString()}
            </div>
            <div class="summary-item">
                <strong>영상 길이:</strong> ${formatDuration(summary.video_duration)}
            </div>
            <div class="summary-item">
                <strong>해상도:</strong> ${summary.resolution.width}x${summary.resolution.height}
            </div>
            <div class="summary-item">
                <strong>최대 위험도:</strong> <span class="grade-${getGradeName(summary.max_grade)}">${getGradeDisplayName(summary.max_grade)}</span>
            </div>
            <div class="summary-item">
                <strong>평균 탐지 수:</strong> ${summary.avg_detections.toFixed(1)}
            </div>
        </div>
    `;

    // 프레임별 결과 표시
    displayFrameResults(results.frame_results);

    // 차트 그리기
    drawAnalysisChart(results.frame_results);

    // 스크롤 이동
    resultsSection.scrollIntoView({ behavior: 'smooth' });
}

// 프레임별 결과 표시
function displayFrameResults(frameResults) {
    const frameResultsDiv = document.getElementById('frameResults');
    
    frameResultsDiv.innerHTML = '<h4>프레임별 분석 결과</h4>';
    
    frameResults.forEach((frame, index) => {
        const frameDiv = document.createElement('div');
        frameDiv.className = 'frame-item';
        
        frameDiv.innerHTML = `
            <div class="frame-info">
                <div class="frame-time">${formatTime(frame.timestamp)}</div>
                <div class="frame-stats">
                    탐지: ${frame.detections}개 | 
                    면적 비율: ${(frame.area_ratio * 100).toFixed(2)}% | 
                    신뢰도: ${(frame.avg_confidence * 100).toFixed(1)}%
                </div>
            </div>
            <div class="smoke-grade-badge grade-${frame.smoke_grade}">
                ${getGradeDisplayName(frame.grade_value)}
            </div>
        `;
        
        frameResultsDiv.appendChild(frameDiv);
    });
}

// 분석 차트 그리기
function drawAnalysisChart(frameResults) {
    const ctx = document.getElementById('analysisChart').getContext('2d');
    
    // 기존 차트가 있으면 제거
    if (analysisChart) {
        analysisChart.destroy();
    }
    
    const labels = frameResults.map(frame => formatTime(frame.timestamp));
    const areaData = frameResults.map(frame => (frame.area_ratio * 100).toFixed(2));
    const gradeData = frameResults.map(frame => frame.grade_value);
    const confidenceData = frameResults.map(frame => (frame.avg_confidence * 100).toFixed(1));
    
    analysisChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '면적 비율 (%)',
                    data: areaData,
                    borderColor: '#667eea',
                    backgroundColor: 'rgba(102, 126, 234, 0.1)',
                    tension: 0.4,
                    yAxisID: 'y'
                },
                {
                    label: '위험도 등급',
                    data: gradeData,
                    borderColor: '#f56565',
                    backgroundColor: 'rgba(245, 101, 101, 0.1)',
                    tension: 0.4,
                    yAxisID: 'y1'
                },
                {
                    label: '신뢰도 (%)',
                    data: confidenceData,
                    borderColor: '#48bb78',
                    backgroundColor: 'rgba(72, 187, 120, 0.1)',
                    tension: 0.4,
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                title: {
                    display: true,
                    text: '시간대별 화재 탐지 분석 결과'
                },
                legend: {
                    display: true,
                    position: 'top'
                }
            },
            scales: {
                x: {
                    display: true,
                    title: {
                        display: true,
                        text: '시간'
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: '면적 비율 (%) / 신뢰도 (%)'
                    },
                    min: 0,
                    max: 100
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: '위험도 등급'
                    },
                    min: 0,
                    max: 3,
                    grid: {
                        drawOnChartArea: false,
                    },
                }
            }
        }
    });
}

// 실시간 통계 업데이트 시작
function startStatsUpdate() {
    updateStats(); // 즉시 한 번 실행
    statsUpdateInterval = setInterval(updateStats, 5000); // 5초마다 업데이트
}

// 통계 업데이트
function updateStats() {
    fetch('/stats')
        .then(response => response.json())
        .then(data => {
            document.getElementById('avgAreaRatio').textContent = (data.avg_area_ratio * 100).toFixed(2) + '%';
            document.getElementById('maxAreaRatio').textContent = (data.max_area_ratio * 100).toFixed(2) + '%';
            document.getElementById('trend').textContent = getTrendDisplayName(data.trend);
            document.getElementById('dataPoints').textContent = data.data_points;
        })
        .catch(error => {
            console.error('통계 업데이트 오류:', error);
        });
}

// 통계 리셋
function resetStats() {
    fetch('/reset')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showNotification('통계가 리셋되었습니다.', 'success');
                updateStats();
            }
        })
        .catch(error => {
            showNotification('통계 리셋 중 오류가 발생했습니다.', 'error');
        });
}

// 실시간 탐지 시작
function startRealtime() {
    fetch('/start_realtime')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showNotification('실시간 탐지가 시작되었습니다.', 'success');
                
                // UI 업데이트
                document.getElementById('startRealtimeBtn').style.display = 'none';
                document.getElementById('stopRealtimeBtn').style.display = 'inline-flex';
                document.getElementById('captureBtn').style.display = 'inline-flex';
                document.getElementById('videoContainer').style.display = 'block';
                
                // 비디오 스트림 시작
                document.getElementById('videoStream').src = '/video_feed';
                
                // 실시간 통계 업데이트 시작
                startRealtimeStatsUpdate();
                isRealtimeActive = true;
            } else {
                showNotification(data.message, 'error');
            }
        })
        .catch(error => {
            showNotification('실시간 탐지 시작 중 오류가 발생했습니다.', 'error');
        });
}

// 실시간 탐지 정지
function stopRealtime() {
    fetch('/stop_realtime')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showNotification('실시간 탐지가 정지되었습니다.', 'info');
                
                // UI 업데이트
                document.getElementById('startRealtimeBtn').style.display = 'inline-flex';
                document.getElementById('stopRealtimeBtn').style.display = 'none';
                document.getElementById('captureBtn').style.display = 'none';
                document.getElementById('videoContainer').style.display = 'none';
                
                // 비디오 스트림 정지
                document.getElementById('videoStream').src = '';
                
                // 실시간 통계 업데이트 정지
                stopRealtimeStatsUpdate();
                isRealtimeActive = false;
            } else {
                showNotification(data.message, 'error');
            }
        })
        .catch(error => {
            showNotification('실시간 탐지 정지 중 오류가 발생했습니다.', 'error');
        });
}

// 프레임 캡처
function captureFrame() {
    fetch('/capture_frame')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showNotification(`프레임이 캡처되었습니다. (총 탐지: ${data.detections}개)`, 'success');
                
                // 캡처된 이미지를 새 창에서 표시 (선택사항)
                const newWindow = window.open();
                newWindow.document.write(`
                    <html>
                        <head><title>캡처된 프레임 - ${data.timestamp}</title></head>
                        <body style="margin: 0; padding: 20px; text-align: center; background: #f0f0f0;">
                            <h2>캡처된 프레임</h2>
                            <p>시간: ${new Date(data.timestamp).toLocaleString()}</p>
                            <p>총 탐지된 객체: ${data.detections}개</p>
                            <p>화재: ${data.fire_count || 0}개 | 연기: ${data.smoke_count || 0}개</p>
                            <img src="data:image/jpeg;base64,${data.image}" style="max-width: 100%; border: 1px solid #ddd; border-radius: 8px;" />
                        </body>
                    </html>
                `);
            } else {
                showNotification(data.error, 'error');
            }
        })
        .catch(error => {
            showNotification('프레임 캡처 중 오류가 발생했습니다.', 'error');
        });
}

// 실시간 통계 업데이트 시작
function startRealtimeStatsUpdate() {
    updateRealtimeStats(); // 즉시 한 번 실행
    realtimeStatsInterval = setInterval(updateRealtimeStats, 1000); // 1초마다 업데이트
}

// 실시간 통계 업데이트 정지
function stopRealtimeStatsUpdate() {
    if (realtimeStatsInterval) {
        clearInterval(realtimeStatsInterval);
        realtimeStatsInterval = null;
    }
}

// 실시간 통계 업데이트
function updateRealtimeStats() {
    if (!isRealtimeActive) return;
    
    fetch('/realtime_stats')
        .then(response => response.json())
        .then(data => {
            // 실시간 정보 업데이트
            const gradeElement = document.getElementById('currentGrade');
            gradeElement.textContent = getGradeDisplayName(data.current_grade);
            gradeElement.className = `info-value grade-${data.current_grade}`;
            
            document.getElementById('fireCount').textContent = data.fire_count || 0;
            document.getElementById('smokeCount').textContent = data.smoke_count || 0;
            document.getElementById('frameCount').textContent = data.frame_count;
            
            // 일반 통계도 함께 업데이트
            document.getElementById('avgAreaRatio').textContent = (data.avg_area_ratio * 100).toFixed(2) + '%';
            document.getElementById('maxAreaRatio').textContent = (data.max_area_ratio * 100).toFixed(2) + '%';
            document.getElementById('trend').textContent = getTrendDisplayName(data.trend);
            document.getElementById('dataPoints').textContent = data.data_points;
        })
        .catch(error => {
            console.error('실시간 통계 업데이트 오류:', error);
        });
}

// 알림 표시
function showNotification(message, type) {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.classList.add('show');
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

// 유틸리티 함수들
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
}

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function getGradeName(gradeValue) {
    const grades = ['light', 'moderate', 'heavy', 'critical'];
    return grades[gradeValue] || 'light';
}

function getGradeDisplayName(gradeValue) {
    if (typeof gradeValue === 'string') {
        const displayNames = {
            'light': '경미',
            'moderate': '보통', 
            'heavy': '심각',
            'critical': '위험'
        };
        return displayNames[gradeValue] || '경미';
    } else {
        const displayNames = ['경미', '보통', '심각', '위험'];
        return displayNames[gradeValue] || '경미';
    }
}

function getTrendDisplayName(trend) {
    const trendNames = {
        'increasing': '증가',
        'decreasing': '감소',
        'stable': '안정',
        'insufficient_data': '데이터 부족'
    };
    return trendNames[trend] || '안정';
}

// 페이지 종료 시 정리
window.addEventListener('beforeunload', () => {
    if (statsUpdateInterval) {
        clearInterval(statsUpdateInterval);
    }
    if (realtimeStatsInterval) {
        clearInterval(realtimeStatsInterval);
    }
    if (analysisChart) {
        analysisChart.destroy();
    }
    
    // 실시간 탐지가 활성화되어 있으면 정지
    if (isRealtimeActive) {
        fetch('/stop_realtime').catch(() => {});
    }
});
