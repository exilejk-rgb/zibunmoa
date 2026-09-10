// --------------------------------------------------
// 주소(도로명/지번) → PNU 변환 (우회 방식)
//
// 1) 주소 → 좌표 (V-WORLD address API, getcoord)
//    - 먼저 도로명(ROAD)으로 시도
//    - 실패하면 지번(PARCEL)으로 재시도
// 2) 좌표 → PNU (V-WORLD data API, GetFeature)
//    - 연속지적도 레이어(LP_PA_CBND_BUBUN)에 좌표가
//      속한 필지를 공간질의로 찾아 pnu 추출
//
// ⚠ 기존 /api/vworld.js 에서 쓰는 환경변수 키 이름과
//   반드시 동일하게 맞춰주세요 (여기서는 VWORLD_API_KEY 가정).
// --------------------------------------------------

export default async function handler(req, res) {

    if (req.method !== "GET") {
        return res.status(405).json({
            success: false,
            error: "GET 요청만 지원합니다."
        });
    }

    const address = String(req.query.address || "").trim();

    if (!address) {
        return res.status(400).json({
            success: false,
            error: "주소를 입력해 주세요."
        });
    }

    const apiKey = process.env.VWORLD_API_KEY;

    if (!apiKey) {
        return res.status(500).json({
            success: false,
            error: "서버에 VWORLD_API_KEY 환경변수가 설정되어 있지 않습니다."
        });
    }

    try {

        const point = await geocodeAddress(address, apiKey);

        const pnu = await pointToPnu(point.x, point.y, apiKey);

        if (!pnu) {
            return res.status(404).json({
                success: false,
                error: "좌표는 찾았지만 해당 위치의 필지(PNU)를 찾지 못했습니다. 주소를 다시 확인해 주세요."
            });
        }

        return res.status(200).json({
            success: true,
            pnu,
            matchedAddress: point.matchedAddress,
            addressType: point.addressType,   // "ROAD" | "PARCEL"
            x: point.x,
            y: point.y
        });

    } catch (error) {

        console.error(error);

        return res.status(502).json({
            success: false,
            error: error.message || "주소 변환 중 오류가 발생했습니다."
        });

    }

}


// --------------------------------------------------
// 1단계: 주소 → 좌표 (도로명 우선 시도, 실패 시 지번 재시도)
// --------------------------------------------------

async function geocodeAddress(address, apiKey) {

    const attempts = [
        { label: "ROAD", vworldType: "ROAD" },
        { label: "PARCEL", vworldType: "PARCEL" }
    ];

    let lastError = null;

    for (const attempt of attempts) {

        const url = new URL("https://api.vworld.kr/req/address");

        url.searchParams.set("service", "address");
        url.searchParams.set("request", "getcoord");
        url.searchParams.set("version", "2.0");
        url.searchParams.set("crs", "epsg:4326");
        url.searchParams.set("address", address);
        url.searchParams.set("type", attempt.vworldType);
        url.searchParams.set("format", "json");
        url.searchParams.set("key", apiKey);

        const response = await fetch(url.toString());
        const data = await response.json().catch(() => null);

        const status = data?.response?.status;

        if (status === "OK" && data?.response?.result?.point) {

            const point = data.response.result.point;
            const refinedText =
                data.response.refined?.text || address;

            return {
                x: point.x,
                y: point.y,
                matchedAddress: refinedText,
                addressType: attempt.label
            };

        }

        lastError =
            data?.response?.error?.text ||
            `주소 매칭 실패 (${attempt.label} 시도)`;

    }

    throw new Error(
        `입력하신 주소를 찾을 수 없습니다 (도로명/지번 모두 실패): ${lastError}`
    );

}


// --------------------------------------------------
// 2단계: 좌표 → PNU (연속지적도 레이어 공간질의)
// --------------------------------------------------

async function pointToPnu(x, y, apiKey) {

    const url = new URL("https://api.vworld.kr/req/data");

    url.searchParams.set("service", "data");
    url.searchParams.set("request", "GetFeature");
    url.searchParams.set("data", "LP_PA_CBND_BUBUN"); // 연속지적도(지번)
    url.searchParams.set("key", apiKey);
    url.searchParams.set("geomFilter", `POINT(${x} ${y})`);
    url.searchParams.set("crs", "EPSG:4326");
    url.searchParams.set("size", "1");
    url.searchParams.set("page", "1");
    url.searchParams.set("format", "json");

    const response = await fetch(url.toString());
    const data = await response.json().catch(() => null);

    const features =
        data?.response?.result?.featureCollection?.features;

    if (!features || features.length === 0) {
        return null;
    }

    return features[0].properties?.pnu || null;

}
