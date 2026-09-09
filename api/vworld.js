// api/vworld.js

export default async function handler(req, res) {
  // CORS 허용 헤더 설정 (Vercel 환경 내 통신 허용)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

  // OPTIONS 요청 처리 (Preflight)
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // 클라이언트에서 넘어온 주소(파라미터) 받기
  const { address } = req.query;

  if (!address) {
    return res.status(400).json({ error: '주소가 필요합니다.' });
  }

  // 발급받으신 브이월드 API 키
  const VWORLD_API_KEY = "6BCCB1B5-0A6C-33A1-A7AC-15BE0CCACD63";
  // V-World API 도메인 제약에 맞춰 요청할 가짜(또는 실제 Vercel) 도메인 입력 필요 (브이월드 키 발급 시 등록한 도메인)
  const DOMAIN = "your-vercel-domain.vercel.app"; // 실제 배포 도메인으로 변경 권장

  // 브이월드 토지특성조회 API URL (예시)
  // 실제 브이월드 API 문서에 따라 정확한 엔드포인트 URL과 파라미터를 조합하세요.
  const targetUrl = `http://api.vworld.kr/req/data?service=data&request=GetFeature&data=LT_C_NQUNJAE&key=${VWORLD_API_KEY}&domain=${DOMAIN}&attrFilter=pnu:like:${encodeURIComponent(address)}`;

  try {
    // Vercel 서버에서 브이월드 서버로 직접 요청 (브라우저를 거치지 않으므로 CORS 발생 X)
    const response = await fetch(targetUrl);
    
    if (!response.ok) {
       throw new Error(`V-World API Error: ${response.status}`);
    }

    const data = await response.json();
    
    // 받아온 데이터를 그대로 프론트엔드(index.html)로 반환
    res.status(200).json(data);
    
  } catch (error) {
    console.error("V-World Proxy Error:", error);
    res.status(500).json({ error: '브이월드 데이터를 가져오는 데 실패했습니다.' });
  }
}
