if vim.g.loaded_concerto then return end
vim.g.loaded_concerto = true

vim.api.nvim_create_user_command("Concerto", function(opts) require("concerto").build(opts) end,
  { nargs = "*", range = true, desc = "Open Concerto, with the selection and a request" })
vim.api.nvim_create_user_command("ConcertoPlan", function(opts) require("concerto").plan(opts) end,
  { nargs = "*", range = true, desc = "Plan with Concerto without building" })
