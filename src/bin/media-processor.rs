//! Execute one of the installed media tools without network system calls.

#[cfg(target_os = "linux")]
fn restrict_network() -> Result<(), libseccomp::error::SeccompError> {
    use libseccomp::{ScmpAction, ScmpFilterContext, ScmpSyscall};

    const OPERATION_NOT_PERMITTED: i32 = 1;
    const NETWORK_CALLS: &[&str] = &[
        "socket",
        "socketpair",
        "connect",
        "bind",
        "listen",
        "accept",
        "accept4",
        "sendto",
        "sendmsg",
        "sendmmsg",
        "recvfrom",
        "recvmsg",
        "recvmmsg",
        "io_uring_setup",
        "io_uring_enter",
        "io_uring_register",
    ];

    let mut filter = ScmpFilterContext::new(ScmpAction::Allow)?;
    // The child runs as the service user and cannot use exec to drop this filter.
    filter.set_ctl_nnp(true)?;
    for name in NETWORK_CALLS {
        let syscall = ScmpSyscall::from_name(name)?;
        filter.add_rule(ScmpAction::Errno(OPERATION_NOT_PERMITTED), syscall)?;
    }

    filter.load()
}

#[cfg(target_os = "linux")]
fn main() -> std::process::ExitCode {
    use std::{
        os::unix::process::CommandExt,
        process::{Command, ExitCode},
    };

    let mut arguments = std::env::args_os();
    arguments.next();
    let program = arguments.next();
    let executable = match program.as_deref().and_then(std::ffi::OsStr::to_str) {
        Some("ffmpeg") => "/usr/bin/ffmpeg",
        Some("ffprobe") => "/usr/bin/ffprobe",
        _ => return ExitCode::FAILURE,
    };

    if restrict_network().is_err() {
        eprintln!("Failed to apply media processor network restrictions");
        return ExitCode::from(125);
    }

    let error = Command::new(executable).args(arguments).env_clear().exec();
    eprintln!("Failed to start media tool: {error}");

    ExitCode::from(125)
}

#[cfg(not(target_os = "linux"))]
fn main() -> std::process::ExitCode {
    eprintln!("Media codec processing requires the Linux Worker");
    std::process::ExitCode::from(125)
}
