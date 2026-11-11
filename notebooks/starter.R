# Starter script for the in-browser R console (webR). Base R only: no packages are downloaded.
# It loads one disease's published data and summarises a country's default series.
# The data aggregates official public reports; it is not a surveillance system and not medical advice.
BASE <- "https://understandingoutbreaks.com/data/v1"
DISEASE <- "measles"; ISO3 <- "KEN"
tmp <- tempfile(fileext = ".csv.gz")
download.file(paste0(BASE, "/bulk/timeseries/disease=", DISEASE, "/data.csv.gz"), tmp, mode = "wb", quiet = TRUE)
ts <- read.csv(gzfile(tmp), stringsAsFactors = FALSE)
country <- ts[ts$iso3 == ISO3 & ts$is_default_series == "True", ]
country <- country[order(country$period_start), ]
cat("rows:", nrow(country), "| source:", country$source_id[1], "| snapshot:", country$snapshot_id[1], "\n")
complete <- country[country$likely_incomplete != "True", ]
print(tail(complete[, c("period_start", "value", "rate_per_100k", "case_definition")], 8))
cat("Highest reported value:", max(complete$value, na.rm = TRUE), "in", complete$period_start[which.max(complete$value)], "\n")
cat("Likely-incomplete periods left out:", sum(country$likely_incomplete == "True"), "\n")
cat("License:", country$license[1], "\n")
