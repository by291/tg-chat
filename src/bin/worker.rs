use std::process::ExitCode;

use clap::Parser;
use tg_chat::{
    config::{ServiceKind, Settings},
    runtime, telemetry,
};

#[derive(Parser)]
#[command(about = "TG Chat background process and internal health listener", version)]
struct Arguments;

async fn execute() -> Result<(), Box<dyn std::error::Error>> {
    let settings = Settings::from_env(ServiceKind::Worker)?;
    telemetry::initialize(settings.log_level)?;

    runtime::serve(settings, ServiceKind::Worker).await?;
    Ok(())
}

#[tokio::main]
async fn main() -> ExitCode {
    Arguments::parse();

    match execute().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Worker startup failed: {error}");
            ExitCode::FAILURE
        }
    }
}
