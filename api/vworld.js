// api/vworld.js

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "GET 요청만 허용됩니다."
    });
  }

  try {
    const { pnu } = req.query;

    if (!pnu) {
      return res.status(400).json({
        success: false,
        error: "PNU가 필요합니다."
      });
    }

    // 숫자만 추출
    const cleanPnu = String(pnu).replace(/\D/g, "");

    // PNU는 19자리
    if (cleanPnu.length !== 19) {
      return res.status(400).json({
        success: false,
        error: "PNU는 19자리 숫자여야 합니다.",
        receivedPnu: cleanPnu
      });
    }

    // ----------------------------------------------------
    // V-World API Key
    // Vercel → Settings → Environment Variables
    // VWORLD_API_KEY 에 기존 개발키를 입력
    // ----------------------------------------------------
    const VWORLD_API_KEY = process.env.VWORLD_API_KEY;

    if (!VWORLD_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "VWORLD_API_KEY 환경변수가 설정되지 않았습니다."
      });
    }

    // ----------------------------------------------------
    // 현재 연도부터 과거 연도까지 조회
    // 해당 연도 데이터가 없을 경우 이전 연도로 자동 검색
    // ----------------------------------------------------
    const currentYear = new Date().getFullYear();

    let landCharacteristics = null;
    let landPrice = null;
    let usedYear = null;

    // 최근 7개년까지 검색
    for (let year = currentYear; year >= currentYear - 7; year--) {

      // ---------------------------------------------
      // ① 토지특성정보
      // 면적(lndpclAr), 지목, 이용상황 등
      // ---------------------------------------------
      const landUrl = new URL(
        "https://api.vworld.kr/ned/data/getLandCharacteristics"
      );

      landUrl.searchParams.set("pnu", cleanPnu);
      landUrl.searchParams.set("format", "xml");
      landUrl.searchParams.set("key", VWORLD_API_KEY);
      landUrl.searchParams.set("stdrYear", year);

      const landResponse = await fetch(landUrl.toString());

      if (!landResponse.ok) {
        continue;
      }

      const landXml = await landResponse.text();

      // V-World 오류 응답 확인
      if (
        landXml.includes("INVALID_KEY") ||
        landXml.includes("SERVICE_ACCESS_DENIED") ||
        landXml.includes("ERROR")
      ) {
        return res.status(502).json({
          success: false,
          error: "V-World API 인증 또는 서비스 오류",
          detail: landXml.substring(0, 1000)
        });
      }

      // 실제 데이터가 존재하는지 확인
      const areaMatch = landXml.match(
        /<lndpclAr[^>]*>([\d.,]+)<\/lndpclAr>/
      );

      const priceMatch = landXml.match(
        /<pblntfPclnd[^>]*>([\d.,]+)<\/pblntfPclnd>/
      );

      if (areaMatch || priceMatch) {
        landCharacteristics = {
          area: areaMatch
            ? Number(areaMatch[1].replace(/,/g, ""))
            : null,

          price: priceMatch
            ? Number(priceMatch[1].replace(/,/g, ""))
            : null
        };

        usedYear = year;
        break;
      }
    }

    // ----------------------------------------------------
    // 토지특성 조회 자체가 안 된 경우
    // ----------------------------------------------------
    if (!landCharacteristics) {
      return res.status(404).json({
        success: false,
        error: "V-World에서 해당 PNU의 토지특성정보를 찾을 수 없습니다.",
        pnu: cleanPnu
      });
    }

    // ----------------------------------------------------
    // ② 개별공시지가 전용 API
    // 더 정확한 공시지가 및 기준연도 확보
    // ----------------------------------------------------
    for (let year = usedYear; year >= currentYear - 7; year--) {

      const priceUrl = new URL(
        "https://api.vworld.kr/ned/data/getIndvdLandPriceAttr"
      );

      priceUrl.searchParams.set("pnu", cleanPnu);
      priceUrl.searchParams.set("format", "xml");
      priceUrl.searchParams.set("key", VWORLD_API_KEY);
      priceUrl.searchParams.set("stdrYear", year);

      const priceResponse = await fetch(priceUrl.toString());

      if (!priceResponse.ok) {
        continue;
      }

      const priceXml = await priceResponse.text();

      if (
        priceXml.includes("INVALID_KEY") ||
        priceXml.includes("SERVICE_ACCESS_DENIED")
      ) {
        return res.status(502).json({
          success: false,
          error: "V-World 개별공시지가 API 오류",
          detail: priceXml.substring(0, 1000)
        });
      }

      const priceMatch = priceXml.match(
        /<pblntfPclnd[^>]*>([\d.,]+)<\/pblntfPclnd>/
      );

      const yearMatch = priceXml.match(
        /<stdrYear[^>]*>(\d+)<\/stdrYear>/
      );

      if (priceMatch) {
        landPrice = {
          price: Number(priceMatch[1].replace(/,/g, "")),
          year: yearMatch ? Number(yearMatch[1]) : year
        };

        break;
      }
    }

    // ----------------------------------------------------
    // 최종 공시지가
    // 개별공시지가 API가 있으면 그것을 우선 사용
    // ----------------------------------------------------
    const finalPrice =
      landPrice?.price ??
      landCharacteristics.price;

    const finalYear =
      landPrice?.year ??
      usedYear;

    if (
      !Number.isFinite(landCharacteristics.area) ||
      !Number.isFinite(finalPrice)
    ) {
      return res.status(404).json({
        success: false,
        error: "V-World 응답에서 면적 또는 공시지가를 확인하지 못했습니다.",
        pnu: cleanPnu
      });
    }

    // ----------------------------------------------------
    // 최종 정상 응답
    // ----------------------------------------------------
    return res.status(200).json({
      success: true,

      source: "V-World",

      pnu: cleanPnu,

      area: landCharacteristics.area,

      price: finalPrice,

      year: finalYear,

      totalPrice:
        Math.round(landCharacteristics.area * finalPrice),

      queriedAt: new Date().toISOString()
    });

  } catch (error) {

    console.error("V-World API Error:", error);

    return res.status(500).json({
      success: false,
      error: "V-World 데이터를 가져오는 중 서버 오류가 발생했습니다.",
      detail: error.message
    });
  }
}
