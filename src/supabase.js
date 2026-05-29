import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// Храним user_id в куки — работает везде включая Safari на iPhone
function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))
  return match ? match[2] : null
}

function setCookie(name, value) {
  // Храним 10 лет
  const expires = new Date()
  expires.setFullYear(expires.getFullYear() + 10)
  document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Lax`
}

export function getUserId() {
  let id = getCookie('chrono-user-id')
  if (!id) {
    id = crypto.randomUUID()
    setCookie('chrono-user-id', id)
  }
  return id
}
