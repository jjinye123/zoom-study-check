// api/cron/weekly-report.js
// Vercel Cron Job — 매주 토요일 10:00 KST 자동 실행
//
// 동작 순서:
//   1. Supabase settings 테이블에서 카카오 refresh_token 읽기
//   2. 카카오 API로 access_token 갱신
//   3. refresh_token이 새로 발급됐으면 Supabase에 저장
//   4. Supabase에서 이번 주 출석 데이터 조회 + 리포트 문자열 생성
//   5. 카카오 "나에게 보내기" API로 메시지 전송

import { createClient } from '@supabase/supabase-js'

// ── 상수
const GOAL_SECONDS  = 18000 // 5시간
const KAKAO_TOKEN_URL   = 'https://kauth.kakao.com/oauth/token'
const KAKAO_SEND_URL    = 'https://kapi.kakao.com/v2/api/talk/memo/default/send'

// ── KST 기준 이번 주 월요일 ~ 일요일
function getKSTWeekRange() {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000
  const nowKST = new Date(Date.now() + KST_OFFSET_MS)
  const day = nowKST.getUTCDay()
  const diffToMonday = day === 0 ? -6 : 1 - day

  const monday = new Date(nowKST)
  monday.setUTCDate(nowKST.getUTCDate() + diffToMonday)

  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)

  const toStr = d => {
    const y  = d.getUTCFullYear()
    const m  = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(d.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${dd}`
  }
  return { weekStart: toStr(monday), weekEnd: toStr(sunday) }
}

// ── 초 → "N시간 N분"
function formatSeconds(s) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h === 0)   return `${m}분`
  if (m === 0)   return `${h}시간`
  return `${h}시간 ${m}분`
}

// ── YYYY-MM-DD → YYYY.MM.DD
function toKR(dateStr) {
  return dateStr.replace(/-/g, '.')
}

// ── 카카오 토큰 갱신
async function refreshKakaoToken(restApiKey, clientSecret, currentRefreshToken) {
  const params = {
    grant_type:    'refresh_token',
    client_id:     restApiKey,
    refresh_token: currentRefreshToken,
  }
  // 클라이언트 시크릿이 활성화된 경우 반드시 포함해야 함
  if (clientSecret) params.client_secret = clientSecret

  const res = await fetch(KAKAO_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`카카오 토큰 갱신 실패: ${res.status} ${text}`)
  }
  return res.json()
  // 반환: { access_token, token_type, expires_in, refresh_token? }
  // refresh_token은 만료까지 1개월 미만일 때만 새로 발급됨
}

// ── 카카오 나에게 보내기
async function sendKakaoMessage(accessToken, message) {
  const templateObject = {
    object_type: 'text',
    text: message,
    link: {
      web_url:        'https://zoom-study-check.vercel.app',
      mobile_web_url: 'https://zoom-study-check.vercel.app',
    },
  }
  const res = await fetch(KAKAO_SEND_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: new URLSearchParams({
      template_object: JSON.stringify(templateObject),
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`카카오 메시지 전송 실패: ${res.status} ${text}`)
  }
  return res.json()
}

// ────────────────────────────────────────────
// Vercel Serverless Function 핸들러
// ────────────────────────────────────────────
export default async function handler(req, res) {
  // Vercel Cron은 GET 요청으로 호출됨
  // 보안: Vercel이 자동으로 Authorization 헤더를 추가함
  // (CRON_SECRET 환경변수가 있으면 검증)
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = req.headers['authorization']
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  // ── 환경변수 확인
  const supabaseUrl     = process.env.VITE_SUPABASE_URL
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  const kakaoRestApiKey = process.env.KAKAO_REST_API_KEY
  const kakaoClientSecret = process.env.KAKAO_CLIENT_SECRET // 클라이언트 시크릿 활성화 시 필수

  if (!supabaseUrl || !serviceRoleKey || !kakaoRestApiKey) {
    console.error('[cron/weekly-report] 환경변수 누락')
    return res.status(500).json({ error: '환경변수가 설정되지 않았습니다.' })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  try {
    // ── 1. Supabase에서 카카오 refresh_token 읽기
    const { data: tokenRow, error: tokenError } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'kakao_refresh_token')
      .single()

    if (tokenError || !tokenRow) {
      throw new Error('Supabase settings 테이블에서 kakao_refresh_token을 찾을 수 없습니다.')
    }

    const currentRefreshToken = tokenRow.value

    // ── 2. 카카오 access_token 갱신
    const tokenData = await refreshKakaoToken(kakaoRestApiKey, kakaoClientSecret, currentRefreshToken)
    const accessToken = tokenData.access_token
    console.log('[cron] 카카오 access_token 갱신 성공')

    // ── 3. refresh_token이 새로 발급됐으면 Supabase 업데이트
    if (tokenData.refresh_token) {
      const { error: updateError } = await supabase
        .from('settings')
        .upsert(
          { key: 'kakao_refresh_token', value: tokenData.refresh_token, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        )
      if (updateError) {
        console.error('[cron] refresh_token 업데이트 실패:', updateError.message)
      } else {
        console.log('[cron] 새 refresh_token Supabase 저장 완료')
      }
    }

    // ── 4. 이번 주 출석 데이터 조회 + 리포트 생성
    const { weekStart, weekEnd } = getKSTWeekRange()

    const { data: members, error: membersError } = await supabase
      .from('members')
      .select('name')
      .order('created_at', { ascending: true })
    if (membersError) throw membersError

    const { data: sessions, error: sessionsError } = await supabase
      .from('attendance_sessions')
      .select('member_name, duration_seconds')
      .gte('date', weekStart)
      .lte('date', weekEnd)
      .not('duration_seconds', 'is', null)
    if (sessionsError) throw sessionsError

    // 멤버별 합산
    const secondsMap = {}
    sessions?.forEach(row => {
      if (!row.member_name || !row.duration_seconds) return
      secondsMap[row.member_name] = (secondsMap[row.member_name] || 0) + row.duration_seconds
    })

    // 달성/미달성 분류
    const achieved    = []
    const notAchieved = []
    members?.forEach(({ name }) => {
      const total = secondsMap[name] || 0
      const entry = { name, total }
      total >= GOAL_SECONDS ? achieved.push(entry) : notAchieved.push(entry)
    })
    achieved.sort((a, b) => b.total - a.total)
    notAchieved.sort((a, b) => b.total - a.total)

    // 리포트 문자열
    const totalCount    = members?.length ?? 0
    const achievedCount = achieved.length

    let message = `📚 이번 주 스터디 출석 리포트\n\n`
    message += `기간: ${toKR(weekStart)} ~ ${toKR(weekEnd)}\n`
    message += `주간 목표: 5시간`

    if (achieved.length > 0) {
      message += `\n\n✅ 목표 달성`
      achieved.forEach(({ name, total }) => {
        message += `\n- ${name}: ${formatSeconds(total)}`
      })
    }

    if (notAchieved.length > 0) {
      message += `\n\n⚠️ 목표 미달성`
      notAchieved.forEach(({ name, total }) => {
        message += `\n- ${name}: ${formatSeconds(total)}`
      })
    }

    message += `\n\n전체 달성률: ${achievedCount}/${totalCount}명`

    // ── 5. 카카오 나에게 보내기
    await sendKakaoMessage(accessToken, message)
    console.log('[cron] 카카오 메시지 전송 완료')

    return res.status(200).json({
      ok: true,
      message: '리포트 전송 완료',
      period: `${weekStart} ~ ${weekEnd}`,
      achieved: achievedCount,
      total: totalCount,
    })

  } catch (err) {
    console.error('[cron/weekly-report] 오류:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
