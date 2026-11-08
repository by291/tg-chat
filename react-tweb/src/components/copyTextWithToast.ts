import { showToast } from './toastStore';

interface CopyTextOptions {
  text: string;
  successMessage: string;
  errorMessage: string;
}

/** Copy exact text and report success or failure through the application toast. */
export async function copyTextWithToast({ text, successMessage, errorMessage }: CopyTextOptions) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch {
    showToast(errorMessage);
  }
}
