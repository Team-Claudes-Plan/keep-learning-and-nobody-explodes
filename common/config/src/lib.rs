use anyhow::{Result, anyhow};
use envy::{Error, keep_names};
use serde::de::DeserializeOwned;

#[doc(hidden)]
pub use serde as __serde;
#[doc(hidden)]
pub use serde_inline_default::serde_inline_default as __serde_inline_default;

pub trait Config: DeserializeOwned {
    fn init() -> Result<Self> {
        keep_names().from_env().map_err(|e| match e {
            Error::MissingValue(value) => {
                anyhow!("Environment variable `{value}` not set")
            }
            Error::Custom(msg) => {
                anyhow!("Failed to parse environment variable: {msg}")
            }
        })
    }
}

#[macro_export]
macro_rules! define_config {
    ($name:ident { $($field:ident($env:literal): $value:ty $(= $default:expr)?,)* }) => {
        #[$crate::__serde_inline_default]
        #[derive($crate::__serde::Deserialize)]
        #[serde(crate = "config::__serde")]
        pub struct $name {
            $(
                $(
                    #[serde_inline_default($default)]
                )?
                #[serde(rename = $env)]
                pub $field: $value,
            )*
        }

        impl $crate::Config for $name {}
    };
}
