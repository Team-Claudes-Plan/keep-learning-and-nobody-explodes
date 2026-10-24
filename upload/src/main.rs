use xberg::{ExtractInput, ExtractionConfig, extract};

#[tokio::main]
async fn main() -> xberg::Result<()> {
    let config = ExtractionConfig::default();
    let output = Box::pin(extract(ExtractInput::from_uri("path/to/pdf.pdf"), &config)).await?;
    let document = &output.results[0];
    println!("{}", document.content);
    Ok(())
}
