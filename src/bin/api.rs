use std::{
    collections::HashMap,
    io::{self, Read},
    process::ExitCode,
};

use clap::{Parser, Subcommand};
use tg_chat::{
    accounts::{
        AccountService, AccountSettings,
        operator::{
            OperatorCreation, PolicyChange, RegistrationPolicy, SuspensionChange, UserStatus,
        },
    },
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
    /// Inspect or retry exhausted realtime wakeups through trusted database access.
    Wakeups {
        #[command(subcommand)]
        operation: WakeupCommand,
    },
    /// Perform audited account operations through trusted database access.
    Operator {
        #[command(subcommand)]
        operation: OperatorCommand,
    },
}

#[derive(Subcommand)]
enum WakeupCommand {
    /// List at most 100 exhausted wakeups with sanitized failure reasons.
    List,
    /// Retry one exhausted wakeup after repairing the realtime dependency.
    Retry {
        #[arg(long)]
        user_id: uuid::Uuid,
    },
}

const MAX_PASSWORD_INPUT_BYTES: u64 = 1026;

#[derive(Subcommand)]
enum OperatorCommand {
    /// Create an operator; read one password line from stdin.
    Create {
        #[arg(long)]
        username: String,
        #[arg(long)]
        display_name: String,
    },
    /// Open public account registration.
    OpenRegistration {
        #[arg(long)]
        reason: String,
    },
    /// Close public account registration.
    CloseRegistration {
        #[arg(long)]
        reason: String,
    },
    /// Suspend an account and revoke all its sessions.
    Suspend {
        #[arg(long)]
        username: String,
        #[arg(long)]
        reason: String,
    },
    /// Restore an account without reviving old sessions.
    Restore {
        #[arg(long)]
        username: String,
        #[arg(long)]
        reason: String,
    },
}

fn read_password() -> Result<String, io::Error> {
    let mut password = String::new();
    io::stdin().take(MAX_PASSWORD_INPUT_BYTES).read_to_string(&mut password)?;
    // Remove only the transport newline; spaces remain part of the actual password.
    if password.ends_with('\n') {
        password.pop();
        if password.ends_with('\r') {
            password.pop();
        }
    }

    Ok(password)
}

async fn execute_operator(
    accounts: AccountService,
    command: OperatorCommand,
) -> Result<(), Box<dyn std::error::Error>> {
    match command {
        OperatorCommand::Create {
            username,
            display_name,
        } => {
            let password = read_password()?;
            accounts
                .create_operator(OperatorCreation {
                    username,
                    password,
                    display_name,
                })
                .await?;
        }
        OperatorCommand::OpenRegistration {
            reason,
        } => {
            accounts
                .set_registration_policy(PolicyChange {
                    policy: RegistrationPolicy::Open,
                    reason,
                })
                .await?;
        }
        OperatorCommand::CloseRegistration {
            reason,
        } => {
            accounts
                .set_registration_policy(PolicyChange {
                    policy: RegistrationPolicy::Closed,
                    reason,
                })
                .await?;
        }
        OperatorCommand::Suspend {
            username,
            reason,
        } => {
            accounts
                .set_user_status(SuspensionChange {
                    username,
                    status: UserStatus::Suspended,
                    reason,
                })
                .await?;
        }
        OperatorCommand::Restore {
            username,
            reason,
        } => {
            accounts
                .set_user_status(SuspensionChange {
                    username,
                    status: UserStatus::Active,
                    reason,
                })
                .await?;
        }
    }

    println!("Operator action committed.");
    Ok(())
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
        return Ok(());
    }

    if let Command::Wakeups {
        operation,
    } = command
    {
        let pool = connect_pool(&settings.database);
        let queue = tg_chat::jobs::wakeups::WakeupQueue::new(pool.clone());
        match operation {
            WakeupCommand::List => {
                println!("{}", serde_json::to_string_pretty(&queue.exhausted().await?)?)
            }
            WakeupCommand::Retry {
                user_id,
            } => {
                let is_retried = queue.retry(user_id).await?;
                println!("Retried: {is_retried}");
            }
        }
        pool.close().await;
        return Ok(());
    }

    if let Command::Operator {
        operation,
    } = command
    {
        let values: HashMap<String, String> = std::env::vars().collect();
        let account_settings = AccountSettings::from_values(&values)?;
        let pool = connect_pool(&settings.database);
        let accounts = AccountService::new(pool.clone(), account_settings);
        let outcome = execute_operator(accounts, operation).await;
        pool.close().await;
        return outcome;
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
