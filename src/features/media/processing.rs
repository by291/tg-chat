use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::Stdio,
};

use serde::Deserialize;
use tokio::{
    fs,
    io::{AsyncReadExt, BufReader},
    process::Command,
};

use super::{MediaVariant, UploadPurpose};

const MAX_IMAGE_PIXELS: i64 = 40_000_000;
const MAX_VIDEO_WIDTH: i32 = 3840;
const MAX_VIDEO_HEIGHT: i32 = 2160;
const MAX_VIDEO_SECONDS: i64 = 30 * 60;
const MAX_VOICE_SECONDS: i64 = 10 * 60;
const MAX_PROCESSOR_BYTES: u64 = 768 * 1024 * 1024;
const MAX_VARIANT_BYTES: u64 = 150 * 1024 * 1024;
// Two probes, a transcode, and one derivative together receive at most 90 CPU seconds.
const PROBE_CPU_SECONDS: u64 = 5;
const TRANSCODE_CPU_SECONDS: u64 = 70;
const DERIVATIVE_CPU_SECONDS: u64 = 10;
const MAX_TOOL_OUTPUT_BYTES: u64 = 1024 * 1024;
const SIGNATURE_BYTES: usize = 8192;
const WAVEFORM_SAMPLES: usize = 64;
const WAVEFORM_SAMPLE_RATE: &str = "800";
const WAVEFORM_PEAK: i32 = 100;
const PROCESSOR_UNAVAILABLE: i32 = 125;
const DEMUXERS: &str = "mov,matroska,webm,ogg,wav,jpeg_pipe,png_pipe,webp_pipe,gif";

#[derive(Clone)]
pub(super) struct Processor {
    pub executable: PathBuf,
}

pub(super) enum PreparationError {
    Invalid(&'static str),
    Unavailable(&'static str),
}

pub(super) struct PreparedMedia {
    pub mime_type: &'static str,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub duration_ms: Option<i64>,
    pub waveform: Option<Vec<i16>>,
    pub variants: Vec<PreparedVariant>,
}

pub(super) struct PreparedVariant {
    pub kind: MediaVariant,
    pub mime_type: &'static str,
    pub path: PathBuf,
    pub size_bytes: i64,
}

#[derive(Deserialize)]
struct Probe {
    streams: Vec<ProbeStream>,
    format: ProbeFormat,
}

#[derive(Deserialize)]
struct ProbeStream {
    codec_type: String,
    width: Option<i32>,
    height: Option<i32>,
}

#[derive(Deserialize)]
struct ProbeFormat {
    duration: Option<String>,
}

fn args(values: &[&str]) -> Vec<OsString> {
    values.iter().map(OsString::from).collect()
}

fn input_args(file: &Path) -> Vec<OsString> {
    let mut arguments = args(&[
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        DEMUXERS,
        "-threads",
        "2",
        "-i",
    ]);
    arguments.push(file.as_os_str().to_owned());

    arguments
}

async fn source_mime(
    path: &Path,
    purpose: UploadPurpose,
) -> Result<&'static str, PreparationError> {
    let file = fs::File::open(path)
        .await
        .map_err(|_| PreparationError::Unavailable("scratch_unavailable"))?;
    let mut header = Vec::with_capacity(SIGNATURE_BYTES);
    let mut input = file.take(SIGNATURE_BYTES as u64);
    input
        .read_to_end(&mut header)
        .await
        .map_err(|_| PreparationError::Unavailable("scratch_unavailable"))?;
    let mime_type = infer::get(&header).map(|format| format.mime_type());
    let allowed = match purpose {
        UploadPurpose::Image | UploadPurpose::Avatar => matches!(
            mime_type,
            Some("image/jpeg" | "image/png" | "image/webp" | "image/gif" | "image/avif")
        ),
        UploadPurpose::Video => matches!(
            mime_type,
            Some("video/mp4" | "video/webm" | "video/x-matroska" | "video/quicktime")
        ),
        UploadPurpose::Voice => matches!(
            mime_type,
            Some(
                "audio/mp4"
                    | "audio/x-m4a"
                    | "audio/ogg"
                    | "audio/x-wav"
                    | "video/webm"
                    | "video/mp4"
                    | "video/x-matroska"
                    | "application/ogg"
            )
        ),
        UploadPurpose::Document => return Ok("application/octet-stream"),
    };
    if !allowed {
        return Err(PreparationError::Invalid("unsupported_media_type"));
    }

    mime_type.ok_or(PreparationError::Invalid("unsupported_media_type"))
}

fn dimensions(probe: &Probe) -> Result<(i32, i32), PreparationError> {
    let visual = probe.streams.iter().find(|stream| stream.codec_type == "video");
    let Some(visual) = visual else {
        return Err(PreparationError::Invalid("missing_visual_stream"));
    };
    let dimensions = visual.width.zip(visual.height);
    dimensions
        .filter(|(width, height)| *width > 0 && *height > 0)
        .ok_or(PreparationError::Invalid("invalid_dimensions"))
}

fn duration_ms(probe: &Probe) -> Option<i64> {
    let raw = probe.format.duration.as_deref()?;
    let seconds: f64 = raw.parse().ok()?;
    let milliseconds = (seconds * 1000.0).round();
    if !milliseconds.is_finite() || milliseconds <= 0.0 {
        return None;
    }

    Some(milliseconds as i64)
}

fn verify_duration(duration_ms: Option<i64>, max_seconds: i64) -> Result<(), PreparationError> {
    if duration_ms.is_some_and(|duration| duration > max_seconds * 1000) {
        return Err(PreparationError::Invalid("duration_limit"));
    }

    Ok(())
}

async fn variant(
    path: PathBuf,
    kind: MediaVariant,
    mime_type: &'static str,
) -> Result<PreparedVariant, PreparationError> {
    let metadata =
        fs::metadata(&path).await.map_err(|_| PreparationError::Invalid("invalid_derivative"))?;
    let size_bytes = metadata.len();
    if !(1..=MAX_VARIANT_BYTES).contains(&size_bytes) {
        return Err(PreparationError::Invalid("variant_size_limit"));
    }

    Ok(PreparedVariant {
        path,
        kind,
        mime_type,
        size_bytes: size_bytes as i64,
    })
}

fn waveform(bytes: &[u8]) -> Vec<i16> {
    let (frames, _) = bytes.as_chunks::<2>();
    let samples = frames.len();
    let mut peaks = vec![0; WAVEFORM_SAMPLES];
    if samples == 0 {
        return peaks;
    }

    for (index, pair) in frames.iter().enumerate() {
        let bin = index * WAVEFORM_SAMPLES / samples;
        let sample = i16::from_le_bytes(*pair);
        let amplitude = i32::from(sample).abs();
        let normalized = amplitude * WAVEFORM_PEAK / (i32::from(i16::MAX) + 1);
        peaks[bin] = peaks[bin].max(normalized as i16);
    }

    peaks
}

impl Processor {
    /// Verify the source format and prepare derivatives in private scratch space.
    pub(super) async fn prepare(
        &self,
        source: &Path,
        purpose: UploadPurpose,
    ) -> Result<PreparedMedia, PreparationError> {
        if purpose == UploadPurpose::Document {
            return Ok(PreparedMedia {
                mime_type: "application/octet-stream",
                width: None,
                height: None,
                duration_ms: None,
                waveform: None,
                variants: Vec::new(),
            });
        }
        let mime_type = source_mime(source, purpose).await?;
        let probe = self.probe(source).await?;

        match purpose {
            UploadPurpose::Image | UploadPurpose::Avatar => {
                self.prepare_image(source, mime_type, &probe).await
            }
            UploadPurpose::Video => self.prepare_video(source, mime_type, &probe).await,
            UploadPurpose::Voice => self.prepare_voice(source, mime_type, &probe).await,
            UploadPurpose::Document => Err(PreparationError::Invalid("unsupported_media_type")),
        }
    }

    async fn run(
        &self,
        tool: &str,
        arguments: Vec<OsString>,
        cpu_seconds: u64,
    ) -> Result<Vec<u8>, PreparationError> {
        if !cfg!(target_os = "linux") {
            return Err(PreparationError::Unavailable("sandbox_unavailable"));
        }

        // Resource limits survive exec into the network-restricted codec process.
        let mut command = Command::new("/usr/bin/prlimit");
        command.arg(format!("--as={MAX_PROCESSOR_BYTES}"));
        command.arg(format!("--cpu={cpu_seconds}"));
        command.arg(format!("--fsize={MAX_VARIANT_BYTES}"));
        command.arg("--");
        command.arg(&self.executable);
        command.arg(tool);
        command.args(arguments);
        command.env_clear();
        command.stdin(Stdio::null());
        command.stdout(Stdio::piped());
        command.stderr(Stdio::null());
        command.kill_on_drop(true);

        let mut child =
            command.spawn().map_err(|_| PreparationError::Unavailable("processor_unavailable"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or(PreparationError::Unavailable("processor_output_unavailable"))?;
        let mut output = Vec::new();
        let mut reader = BufReader::new(stdout).take(MAX_TOOL_OUTPUT_BYTES + 1);
        reader
            .read_to_end(&mut output)
            .await
            .map_err(|_| PreparationError::Unavailable("processor_output_unavailable"))?;
        if output.len() as u64 > MAX_TOOL_OUTPUT_BYTES {
            return Err(PreparationError::Invalid("processor_output_limit"));
        }

        let status = child
            .wait()
            .await
            .map_err(|_| PreparationError::Unavailable("processor_unavailable"))?;
        if status.code() == Some(PROCESSOR_UNAVAILABLE) {
            return Err(PreparationError::Unavailable("sandbox_unavailable"));
        }
        if !status.success() {
            return Err(PreparationError::Invalid("media_decode_failed"));
        }

        Ok(output)
    }

    async fn probe(&self, source: &Path) -> Result<Probe, PreparationError> {
        let mut arguments = input_args(source);
        arguments.extend(args(&[
            "-show_entries",
            "stream=codec_type,width,height:format=duration",
            "-of",
            "json",
        ]));
        let output = self.run("ffprobe", arguments, PROBE_CPU_SECONDS).await?;

        serde_json::from_slice(&output)
            .map_err(|_| PreparationError::Invalid("invalid_media_metadata"))
    }

    async fn thumbnail(
        &self,
        source: &Path,
        kind: MediaVariant,
    ) -> Result<PreparedVariant, PreparationError> {
        let output = source.with_file_name(format!("{}.jpg", kind.object_name()));
        let mut arguments = input_args(source);
        arguments.extend(args(&[
            "-nostdin",
            "-filter_threads",
            "1",
            "-map",
            "0:v:0",
            "-frames:v",
            "1",
            "-vf",
            "scale=w='min(1280,iw)':h=-1",
            "-c:v",
            "mjpeg",
            "-threads",
            "1",
        ]));
        arguments.push(output.as_os_str().to_owned());
        self.run("ffmpeg", arguments, DERIVATIVE_CPU_SECONDS).await?;

        variant(output, kind, "image/jpeg").await
    }

    async fn prepare_image(
        &self,
        source: &Path,
        mime_type: &'static str,
        probe: &Probe,
    ) -> Result<PreparedMedia, PreparationError> {
        let (width, height) = dimensions(probe)?;
        if i64::from(width) * i64::from(height) > MAX_IMAGE_PIXELS {
            return Err(PreparationError::Invalid("image_dimension_limit"));
        }

        let thumbnail = self.thumbnail(source, MediaVariant::Thumbnail).await?;

        Ok(PreparedMedia {
            mime_type,
            width: Some(width),
            height: Some(height),
            duration_ms: None,
            waveform: None,
            variants: vec![thumbnail],
        })
    }

    async fn prepare_video(
        &self,
        source: &Path,
        mime_type: &'static str,
        probe: &Probe,
    ) -> Result<PreparedMedia, PreparationError> {
        let (width, height) = dimensions(probe)?;
        if width > MAX_VIDEO_WIDTH || height > MAX_VIDEO_HEIGHT {
            return Err(PreparationError::Invalid("video_dimension_limit"));
        }
        verify_duration(duration_ms(probe), MAX_VIDEO_SECONDS)?;

        let playback = self.video_playback(source).await?;
        let actual = self.probe(&playback.path).await?;
        let duration = duration_ms(&actual).ok_or(PreparationError::Invalid("invalid_duration"))?;
        verify_duration(Some(duration), MAX_VIDEO_SECONDS)?;
        let poster = self.thumbnail(&playback.path, MediaVariant::Poster).await?;
        let (width, height) = dimensions(&actual)?;

        Ok(PreparedMedia {
            mime_type,
            width: Some(width),
            height: Some(height),
            duration_ms: Some(duration),
            waveform: None,
            variants: vec![poster, playback],
        })
    }

    async fn video_playback(&self, source: &Path) -> Result<PreparedVariant, PreparationError> {
        let output = source.with_file_name("playback.mp4");
        let mut arguments = input_args(source);
        arguments.extend(args(&[
            "-nostdin",
            "-filter_threads",
            "1",
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-vf",
            concat!(
                "scale=w='min(1920,iw)':h='min(1080,ih)':",
                "force_original_aspect_ratio=decrease:force_divisible_by=2"
            ),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "fast",
            "-c:a",
            "aac",
            "-threads",
            "2",
            "-movflags",
            "+faststart",
            "-t",
        ]));
        arguments.push(OsString::from((MAX_VIDEO_SECONDS + 1).to_string()));
        arguments.push(output.as_os_str().to_owned());
        self.run("ffmpeg", arguments, TRANSCODE_CPU_SECONDS).await?;

        variant(output, MediaVariant::Playback, "video/mp4").await
    }

    async fn prepare_voice(
        &self,
        source: &Path,
        mime_type: &'static str,
        probe: &Probe,
    ) -> Result<PreparedMedia, PreparationError> {
        let has_audio = probe.streams.iter().any(|stream| stream.codec_type == "audio");
        if !has_audio {
            return Err(PreparationError::Invalid("missing_audio_stream"));
        }
        verify_duration(duration_ms(probe), MAX_VOICE_SECONDS)?;

        let playback = self.voice_playback(source).await?;
        let actual = self.probe(&playback.path).await?;
        let duration = duration_ms(&actual).ok_or(PreparationError::Invalid("invalid_duration"))?;
        verify_duration(Some(duration), MAX_VOICE_SECONDS)?;
        let peaks = self.voice_waveform(&playback.path).await?;

        Ok(PreparedMedia {
            mime_type,
            width: None,
            height: None,
            duration_ms: Some(duration),
            waveform: Some(peaks),
            variants: vec![playback],
        })
    }

    async fn voice_playback(&self, source: &Path) -> Result<PreparedVariant, PreparationError> {
        let output = source.with_file_name("playback.m4a");
        let mut arguments = input_args(source);
        arguments.extend(args(&[
            "-nostdin",
            "-map",
            "0:a:0",
            "-ac",
            "1",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            "-t",
        ]));
        arguments.push(OsString::from((MAX_VOICE_SECONDS + 1).to_string()));
        arguments.push(output.as_os_str().to_owned());
        self.run("ffmpeg", arguments, TRANSCODE_CPU_SECONDS).await?;

        variant(output, MediaVariant::Playback, "audio/mp4").await
    }

    async fn voice_waveform(&self, source: &Path) -> Result<Vec<i16>, PreparationError> {
        let mut arguments = input_args(source);
        arguments.extend(args(&[
            "-nostdin",
            "-map",
            "0:a:0",
            "-ac",
            "1",
            "-ar",
            WAVEFORM_SAMPLE_RATE,
            "-f",
            "s16le",
            "pipe:1",
        ]));
        let output = self.run("ffmpeg", arguments, DERIVATIVE_CPU_SECONDS).await?;

        Ok(waveform(&output))
    }
}
