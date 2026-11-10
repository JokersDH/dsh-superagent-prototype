export function isPalindrome(text) {
  const cleaned = String(text).replace(/\s+/g, '')
  return cleaned === [...cleaned].reverse().join('')
}
