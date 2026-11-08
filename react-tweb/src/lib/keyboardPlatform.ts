/** Use Apple key labels for Macs and iOS devices, including desktop-mode iPads. */
export function isAppleKeyboard(userAgent = navigator.userAgent) {
  return /Macintosh|Mac OS X|iPhone|iPad|iPod/.test(userAgent);
}
