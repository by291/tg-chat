use std::process::ExitCode;

use clap::{Parser, Subcommand};
use tg_chat::{
    config::{ServiceKind, Settings},
    database::{MIGRATOR, connect_pool, migrate},
    http::ApiDocument,
    runtime, telemetry,
};
use utoipa::OpenApi;

#[derive(Parser)]
#[command(about = "TG Chat API and database operations", version)]
struct Arguments {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Serve HTTP requests without applying schema migrations.
    Serve,
    /// Apply the embedded SQLx migrations before starting application processes.
    Migrate,
    /// Write the OpenAPI contract to stdout without runtime configuration.
    Openapi,
}

async fn execute(command: Command) -> Result<(), Box<dyn std::error::Error>> {
    if matches!(command, Command::Openapi) {
        println!("{}", ApiDocument::openapi().to_pretty_json()?);
        return Ok(());
    }

    let settings = Settings::from_env(ServiceKind::Api)?;
    telemetry::initialize(settings.log_level)?;

    if matches!(command, Command::Migrate) {
        let pool = connect_pool(&settings.database);
        let outcome = migrate(&pool, &MIGRATOR).await;
        pool.close().await;
        outcome?;
        tracing::info!("migrations_applied");
        return Ok(());
    }

    runtime::serve(settings, ServiceKind::Api).await?;
    Ok(())
}

#[tokio::main]
async fn main() -> ExitCode {
    let arguments = Arguments::parse();
    let command = arguments.command.unwrap_or(Command::Serve);

    match execute(command).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("API startup failed: {error}");
            ExitCode::FAILURE
        }
    }
}
