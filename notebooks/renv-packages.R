# Pinned environment for the R notebooks. Run once, then render the .qmd files.
# install.packages("remotes")
remotes::install_version("dplyr", "1.1.4")
remotes::install_version("tidyr", "1.3.1")
remotes::install_version("arrow", "17.0.0")
remotes::install_version("ggplot2", "3.5.1")
remotes::install_version("jsonlite", "1.8.9")
remotes::install_version("deSolve", "1.40")
# The versions above are the ones the notebooks were written against. They have not been re-run in this repository's
# local environment (no R was available when it was built); CI runs them. Update the pins together with the notebooks.
