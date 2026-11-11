import type { components } from '@/api/schema';
import { ApiError } from '@/features/auth/SessionOwner';

type UploadStatus = components['schemas']['UploadStatus'];
type UploadPurpose = components['schemas']['UploadPurpose'];
type SignedUpload = components['schemas']['SignedUpload'];
type TransferPlan = components['schemas']['TransferPlan'];
type ReserveUpload = components['schemas']['ReserveUpload'];

const PART_CONCURRENCY = 2;
const PROCESSING_POLL_MS = 1000;
const HEX_DIGITS_PER_BYTE = 2;

export interface MediaSelection {
  filename: string;
  kind: UploadPurpose;
  blob: Blob;
}

export interface PendingMedia {
  occurrenceId: string;
  uploadId: string;
  filename: string;
  kind: UploadPurpose;
  sizeBytes: number;
  sha256?: string;
  blob?: Blob;
  fileId?: string;
}

export interface UploadProgress {
  phase: 'uploading' | 'processing';
  bytes: number;
}

export interface UploadWrite {
  request: SignedUpload;
  blob: Blob;
  signal: AbortSignal;
  onProgress: (bytes: number) => void;
}

interface PartPlanRequest {
  uploadId: string;
  partNumbers: number[];
  signal: AbortSignal;
}

export interface UploadTransport {
  status(uploadId: string, signal: AbortSignal): Promise<UploadStatus | undefined>;
  reserve(request: ReserveUpload, signal: AbortSignal): Promise<UploadStatus>;
  plan(request: PartPlanRequest): Promise<TransferPlan>;
  put(request: UploadWrite): Promise<void>;
  complete(uploadId: string, signal: AbortSignal): Promise<UploadStatus>;
}

export interface ResumeUploadInput {
  item: PendingMedia;
  transport: UploadTransport;
  signal: AbortSignal;
  checkpoint: (item: PendingMedia) => Promise<void>;
  onProgress: (progress: UploadProgress) => void;
}

function missingFile(): ApiError {
  return new ApiError({
    code: 'media_source_missing',
    message: 'Select the original file to continue this upload.',
  });
}

function wait(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();

  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, PROCESSING_POLL_MS);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Calculate the fingerprint before issuing an upload reservation for these exact bytes. */
export async function mediaFingerprint(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash), (byte) => {
    return byte.toString(16).padStart(HEX_DIGITS_PER_BYTE, '0');
  }).join('');
}

/** Give a selected source its stable occurrence and initial upload identity. */
export function pendingMedia(selection: MediaSelection): PendingMedia {
  return {
    occurrenceId: crypto.randomUUID(),
    uploadId: crypto.randomUUID(),
    filename: selection.filename,
    kind: selection.kind,
    sizeBytes: selection.blob.size,
    blob: selection.blob,
  };
}

async function reserveSource(
  input: ResumeUploadInput,
  item: PendingMedia,
): Promise<{ item: PendingMedia; status: UploadStatus }> {
  if (!item.blob) {
    throw missingFile();
  }
  const sha256 = item.sha256 ?? (await mediaFingerprint(item.blob));
  const checkpointed = { ...item, sha256 };
  await input.checkpoint(checkpointed);

  const status = await input.transport.reserve(
    {
      upload_id: item.uploadId,
      purpose: item.kind,
      file_name: item.filename,
      size_bytes: item.sizeBytes,
      sha256,
    },
    input.signal,
  );
  return { item: checkpointed, status };
}

interface UploadBody {
  input: ResumeUploadInput;
  blob: Blob;
  status: UploadStatus;
}

async function singlePut({ input, blob, status }: UploadBody): Promise<void> {
  const plan = await input.transport.plan({
    uploadId: status.upload_id,
    partNumbers: [],
    signal: input.signal,
  });
  if (plan.single_put_complete) {
    return;
  }
  const [request] = plan.requests;
  if (!request) {
    throw new Error('The server did not authorize the upload.');
  }
  await input.transport.put({
    request,
    blob,
    signal: input.signal,
    onProgress: (bytes) => input.onProgress({ phase: 'uploading', bytes }),
  });
}

async function multipart({ input, blob, status }: UploadBody): Promise<void> {
  const partSize = status.part_size_bytes;
  if (!partSize || partSize <= 0) {
    throw new Error('The server returned an invalid part size.');
  }

  const totalParts = Math.ceil(blob.size / partSize);
  const completed = new Set<number>();
  const progress = new Map<number, number>();
  const report = () => {
    let bytes = 0;
    for (const part of completed) {
      bytes += Math.min(partSize, blob.size - (part - 1) * partSize);
    }
    for (const loaded of progress.values()) {
      bytes += loaded;
    }
    input.onProgress({ phase: 'uploading', bytes });
  };

  for (let part = 1; part <= totalParts; part += PART_CONCURRENCY) {
    const nextPart = part + 1;
    const numbers = nextPart <= totalParts ? [part, nextPart] : [part];
    const missing = numbers.filter((number) => !completed.has(number));
    if (missing.length === 0) {
      continue;
    }

    await input.checkpoint(input.item);
    const plan = await input.transport.plan({
      uploadId: status.upload_id,
      partNumbers: missing,
      signal: input.signal,
    });
    for (const number of plan.confirmed_parts) {
      if (number > 0 && number <= totalParts) {
        completed.add(number);
      }
    }
    report();
    const results = await Promise.allSettled(
      plan.requests.map(async (request) => {
        const number = request.part_number;
        if (!number || !missing.includes(number) || completed.has(number)) {
          throw new Error('The server returned an invalid upload part.');
        }
        const offset = (number - 1) * partSize;
        await input.transport.put({
          request,
          blob: blob.slice(offset, offset + partSize),
          signal: input.signal,
          onProgress: (loaded) => {
            progress.set(number, loaded);
            report();
          },
        });
        progress.delete(number);
        completed.add(number);
        report();
      }),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        throw result.reason;
      }
    }
    if (numbers.some((number) => !completed.has(number))) {
      throw new Error('The server did not confirm every requested part.');
    }
  }
}

function rejected(status: UploadStatus): ApiError {
  return new ApiError({
    code: 'media_rejected',
    message: status.error_code
      ? `This file could not be processed (${status.error_code.replaceAll('_', ' ')}).`
      : 'The upload is unavailable. Try again or replace the file.',
  });
}

/** Recover the existing transfer from storage acknowledgements and wait for a ready file. */
export async function resumeUpload(input: ResumeUploadInput): Promise<UploadStatus> {
  let item = input.item;
  let status = await input.transport.status(item.uploadId, input.signal);
  if (status?.state === 'expired' || status?.state === 'cancelled') {
    item = { ...item, uploadId: crypto.randomUUID(), fileId: undefined };
    await input.checkpoint(item);
    status = undefined;
  }
  if (!status) {
    const reserved = await reserveSource(input, item);
    item = reserved.item;
    status = reserved.status;
  }
  // Checkpoints must carry the current upload ID and fingerprint after rotation.
  const activeInput = { ...input, item };
  if (status.state === 'reserved') {
    if (!item.blob) {
      throw missingFile();
    }
    const body = { input: activeInput, blob: item.blob, status };
    if (status.transfer_mode === 'single_put') {
      await singlePut(body);
    } else {
      await multipart(body);
    }
    await input.checkpoint(item);
    status = await input.transport.complete(item.uploadId, input.signal);
  }

  while (status.state === 'uploaded' || status.state === 'processing') {
    input.onProgress({ phase: 'processing', bytes: item.sizeBytes });
    await input.checkpoint(item);
    await wait(input.signal);
    status = (await input.transport.status(item.uploadId, input.signal)) ?? status;
  }
  if (status.state !== 'ready' || !status.file_id) {
    throw rejected(status);
  }

  return status;
}
