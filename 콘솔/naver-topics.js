// 네이버 블로그 1단계 주제 은행 (2026-10-12). 5분야 x 8주제.
// type = 글 유형(없으면 가이드형, 'case' = 사례형). problem = 글 첫 3줄에 둘 고객 문제, kw = 노린 검색어(판정 때 이 말로 블로그 검색), photos = 찍어 둘 사진.
// 상표: 브라더·교세라·시놀로지만 공식(서비스센터·대리점). 엡손 등은 설치 사례로만. 딸깍P카운터·882.kr 언급 금지.
window.NAVER_TOPICS = {
  cats: [
    { id: 'pc', name: '컴퓨터' },
    { id: 'inkjet', name: '잉크젯프린터' },
    { id: 'mfp', name: '디지털복합기' },
    { id: 'laser', name: '레이저프린터' },
    { id: 'nas', name: '시놀로지 NAS' },
  ],
  topics: [
    { id: 'pc-1', cat: 'pc', title: '사무실 PC가 갑자기 느려졌을 때 점검 순서', kw: '사무실 컴퓨터 느려짐', problem: '어제까지 멀쩡하던 PC가 부팅부터 느리다', photos: '작업관리자 화면, 본체 내부 먼지, 교체한 부품' },
    { id: 'pc-2', cat: 'pc', title: '블루스크린이 반복될 때 먼저 볼 것', kw: '컴퓨터 블루스크린 원인', problem: '작업 중 파란 화면이 뜨고 재부팅된다', photos: '블루스크린 화면, 점검 중인 메모리·저장장치' },
    { id: 'pc-3', cat: 'pc', title: '오래된 PC, 고칠까 바꿀까', kw: '컴퓨터 SSD 교체', problem: '5년 넘은 PC를 버리기엔 아깝고 쓰기엔 답답하다', photos: '기존 하드디스크, 새 SSD, 교체 후 부팅 시간' },
    { id: 'pc-4', cat: 'pc', title: '중요 자료가 직원 PC 한 대에만 있을 때', kw: '회사 PC 백업', problem: '견적서·도면이 담당자 PC에만 있다', photos: '정리 전 바탕화면, 백업 설정 화면' },
    { id: 'pc-5', cat: 'pc', title: '윈도우10 지원 종료 뒤 사무실 PC 정리', kw: '윈도우10 지원 종료 사무실', problem: '보안 업데이트가 끊긴 PC를 계속 써도 되는지', photos: '윈도우 버전 확인 화면, 교체·업그레이드한 PC' },
    { id: 'pc-6', type: 'case', cat: 'pc', title: '사무용 PC, 렌탈과 구매 어느 쪽이 맞나', kw: '사무용 컴퓨터 렌탈', problem: '직원이 늘어 PC가 한꺼번에 여러 대 필요하다', photos: '설치한 PC 여러 대, 모니터 배치' },
    { id: 'pc-7', cat: 'pc', title: '사무실 인터넷이 자꾸 끊길 때', kw: '사무실 인터넷 끊김', problem: '오후만 되면 인터넷이 느려지거나 끊긴다', photos: '공유기·허브, 정리 전후 랜선' },
    { id: 'pc-8', cat: 'pc', title: '공장 장비용 PC가 멈췄을 때', kw: '산업용 PC 수리', problem: '장비에 붙은 오래된 PC가 켜지지 않아 라인이 선다', photos: '장비 PC 외관, 교체 부품, 복구 후 화면' },

    { id: 'inkjet-1', cat: 'inkjet', title: '잉크젯 인쇄에 줄이 가고 색이 빠질 때', kw: '잉크젯 프린터 헤드 막힘', problem: '출력물에 가로줄이 생기고 한 색이 안 나온다', photos: '줄 간 출력물, 노즐 점검 인쇄, 청소 후 출력물' },
    { id: 'inkjet-2', cat: 'inkjet', title: '브라더 잉크젯 잉크 흡수체 가득 참 메시지', kw: '브라더 잉크흡수체', problem: '흡수체가 찼다는 표시와 함께 인쇄가 멈췄다', photos: '오류 화면, 흡수체 교체 부위, 정상 출력' },
    { id: 'inkjet-3', cat: 'inkjet', title: '무한잉크와 레이저, 우리 사무실엔 어느 쪽', kw: '무한잉크 레이저 비교', problem: '출력량은 많고 유지비는 줄이고 싶다', photos: '두 기종 나란히, 잉크 탱크, 토너' },
    { id: 'inkjet-4', cat: 'inkjet', title: '오래 안 쓴 잉크젯이 안 나올 때', kw: '잉크젯 오래 안쓰면', problem: '몇 주 만에 켰더니 하얀 종이만 나온다', photos: '빈 출력물, 노즐 점검 결과, 복구 후 출력물' },
    { id: 'inkjet-5', type: 'case', cat: 'inkjet', title: '무한잉크 프린터 임대 설치 사례', kw: '무한잉크 프린터 임대', problem: '잉크값이 부담돼 사무실 프린터를 바꾸려 한다', photos: '설치 전후 자리, 잉크 공급 장치, 시험 출력' },
    { id: 'inkjet-6', cat: 'inkjet', title: '잉크를 넣었는데 인식이 안 될 때', kw: '잉크 인식 안됨', problem: '새 잉크를 넣었는데 없다고 나온다', photos: '오류 메시지, 카트리지 접점, 정상 인식 화면' },
    { id: 'inkjet-7', cat: 'inkjet', title: '컬러 출력이 흐리게 나올 때 설정 점검', kw: '프린터 컬러 흐림', problem: '화면과 달리 출력 색이 흐리고 탁하다', photos: '흐린 출력물, 용지·품질 설정 화면, 조정 후 출력물' },
    { id: 'inkjet-8', type: 'case', cat: 'inkjet', title: '학원·유치원 프린터 임대 설치', kw: '학원 프린터 임대', problem: '수업 자료를 매일 많이 뽑는데 프린터가 자주 선다', photos: '설치 장소, 프린터, 출력한 수업 자료' },

    { id: 'mfp-1', cat: 'mfp', title: '복합기 용지걸림이 자주 날 때', kw: '복합기 용지걸림', problem: '하루에도 몇 번씩 종이가 걸려 문을 연다', photos: '걸린 종이, 급지 롤러, 교체한 롤러' },
    { id: 'mfp-2', cat: 'mfp', title: '스캔해서 PC 폴더나 메일로 안 갈 때', kw: '복합기 스캔 설정', problem: '스캔은 되는데 PC로 파일이 안 들어온다', photos: '복합기 주소록 화면, PC 공유 폴더 설정' },
    { id: 'mfp-3', cat: 'mfp', title: '팩스를 종이 대신 PC로 받기', kw: '복합기 팩스 PC 수신', problem: '받은 팩스를 다시 스캔하느라 시간이 든다', photos: '팩스 수신 설정 화면, PC에 들어온 팩스 파일' },
    { id: 'mfp-4', cat: 'mfp', title: '복합기 임대료, 기본 매수와 추가 요금 읽는 법', kw: '복합기 임대 비용', problem: '월 임대료 말고 추가 요금이 왜 붙는지 모르겠다', photos: '카운터 확인 화면, 사용량 보고서(이름 가림)' },
    { id: 'mfp-5', cat: 'mfp', title: 'A3 복합기와 A4 복합기, 사무실 크기별 고르기', kw: 'A3 A4 복합기 차이', problem: '도면은 가끔 뽑는데 큰 기계를 들여야 하나', photos: 'A3 기종, A4 기종, 설치 공간' },
    { id: 'mfp-6', cat: 'mfp', title: '복합기 임대 계약이 끝날 때 확인할 것', kw: '복합기 렌탈 계약 만료', problem: '계약 만료 안내를 받았는데 무엇을 따져야 할지', photos: '교체 전후 기계, 데이터 삭제 화면' },
    { id: 'mfp-7', cat: 'mfp', title: '부서별 복합기 사용량 나눠 보기', kw: '복합기 부서별 사용량', problem: '어느 부서가 얼마나 뽑는지 알고 싶다', photos: '부서 코드 설정 화면, 부서별 집계 화면' },
    { id: 'mfp-8', type: 'case', cat: 'mfp', title: '공사현장·행사용 복합기 단기 렌탈', kw: '복합기 단기 렌탈', problem: '석 달만 쓸 복합기가 필요하다', photos: '현장 사무실 설치 모습, 기계, 시험 출력' },

    { id: 'laser-1', cat: 'laser', title: '출력물에 세로줄·얼룩이 생길 때', kw: '레이저 프린터 줄 생김', problem: '문서마다 같은 자리에 줄이 생긴다', photos: '줄 간 출력물, 드럼·현상기, 교체 후 출력물' },
    { id: 'laser-2', cat: 'laser', title: '토너를 갈았는데 인식이 안 될 때', kw: '토너 인식 안됨', problem: '새 토너를 넣었는데 교체하라는 표시가 그대로다', photos: '오류 화면, 토너 칩 부위, 정상 화면' },
    { id: 'laser-3', cat: 'laser', title: '드럼 교체 메시지가 떴을 때', kw: '프린터 드럼 교체 시기', problem: '드럼 수명이 다 됐다는데 토너와 무엇이 다른지', photos: '메시지 화면, 드럼과 토너 나란히, 교체 후 출력' },
    { id: 'laser-4', cat: 'laser', title: '재생토너와 정품 토너 차이', kw: '재생토너 정품 차이', problem: '토너값이 부담돼 재생토너를 써도 되는지', photos: '재생토너 작업 과정, 출력 비교' },
    { id: 'laser-5', cat: 'laser', title: '프린터 인쇄가 느려졌을 때', kw: '프린터 인쇄 느림', problem: '한 장 뽑는 데 한참 기다린다', photos: '인쇄 대기열 화면, 드라이버 설정, 개선 후' },
    { id: 'laser-6', cat: 'laser', title: '네트워크 프린터가 갑자기 안 잡힐 때', kw: '네트워크 프린터 연결 안됨', problem: '어제까지 되던 프린터가 PC에서 사라졌다', photos: '프린터 IP 화면, PC 프린터 목록, 재설정 후' },
    { id: 'laser-7', cat: 'laser', title: '흑백 레이저와 컬러 레이저 유지비', kw: '컬러 레이저 프린터 유지비', problem: '컬러가 가끔 필요한데 유지비가 걱정이다', photos: '두 기종, 토너 4색, 출력물' },
    { id: 'laser-8', cat: 'laser', title: '출력물 토너가 손에 묻어날 때', kw: '프린터 토너 묻어남', problem: '출력물을 문지르면 글자가 번진다', photos: '번진 출력물, 정착기 부위, 교체 후 출력물' },

    { id: 'nas-1', cat: 'nas', title: '랜섬웨어에 대비한 NAS 백업', kw: '랜섬웨어 NAS 백업', problem: '랜섬웨어 소식을 들으니 회사 자료가 걱정된다', photos: '스냅샷 설정 화면, 외장 백업, NAS 본체' },
    { id: 'nas-2', cat: 'nas', title: 'NAS 하드디스크 경고가 떴을 때', kw: '시놀로지 하드 교체', problem: '디스크 상태가 경고로 바뀌었다는 메일을 받았다', photos: '경고 화면, 교체 하드, 복구 진행 화면' },
    { id: 'nas-3', cat: 'nas', title: '밖에서 NAS 접속이 안 될 때', kw: '시놀로지 외부 접속', problem: '출장지에서 회사 자료를 열 수 없다', photos: '접속 설정 화면, 공유기 설정(주소 가림)' },
    { id: 'nas-4', cat: 'nas', title: '직원 PC 폴더를 NAS로 자동 백업', kw: '시놀로지 드라이브 PC 백업', problem: '직원마다 백업을 따로 하라고 해도 안 된다', photos: 'Synology Drive 설정 화면, NAS 폴더 구조' },
    { id: 'nas-5', cat: 'nas', title: 'NAS 용량이 가득 찼을 때', kw: 'NAS 용량 부족', problem: '용량 부족 알림이 매일 온다', photos: '저장소 관리자 화면, 증설한 하드' },
    { id: 'nas-6', cat: 'nas', title: '오래된 NAS에서 시놀로지로 자료 옮기기', kw: 'NAS 교체 데이터 이전', problem: '쓰던 NAS가 오래돼 바꾸고 싶은데 자료가 걱정이다', photos: '기존 NAS와 새 NAS, 이전 진행 화면' },
    { id: 'nas-7', cat: 'nas', title: '정전에 대비한 NAS와 UPS 연결', kw: 'NAS UPS 연결', problem: '정전 뒤 NAS가 안 켜져 하루를 날렸다', photos: 'UPS와 NAS 연결, UPS 설정 화면' },
    { id: 'nas-8', cat: 'nas', title: '흩어진 사진·영상을 NAS 한곳에 모으기', kw: '시놀로지 포토', problem: '행사 사진이 폰과 PC 여기저기 흩어져 있다', photos: 'Synology Photos 화면, 폴더 정리 전후' },
  ],
  // 1단계 12편 추천 순서: 분야를 돌아가며, 기존 블로그에 많은 NAS·렌탈 후기는 뒤로.
  phase1: ['mfp-1', 'laser-1', 'inkjet-2', 'pc-1', 'nas-1', 'mfp-2', 'laser-2', 'inkjet-1', 'pc-5', 'nas-4', 'mfp-4', 'laser-6'],
};
