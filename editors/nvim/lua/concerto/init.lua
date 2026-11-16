-- Concerto for Neovim: plan or build the visual selection, or any request, from a command.
local M = {}

M.config = { cmd = "concerto", split = "botright vsplit" }

function M.setup(opts)
  M.config = vim.tbl_extend("force", M.config, opts or {})
end

-- The request for lines first..last of the current buffer: where they are, the code, then what to do.
function M.request_for(first, last, instruction)
  local lines = vim.api.nvim_buf_get_lines(0, first - 1, last, false)
  local path = vim.fn.fnamemodify(vim.api.nvim_buf_get_name(0), ":.")
  local where = (path ~= "" and path or "the current buffer") .. " lines " .. first .. "-" .. last
  local fence = "```" .. (vim.bo.filetype or "")
  return "In " .. where .. ":\n" .. fence .. "\n" .. table.concat(lines, "\n") .. "\n```\n\n" .. instruction
end

-- Runs argv in a terminal in a new split, in the editor's working directory.
function M.open_terminal(argv)
  vim.cmd(M.config.split)
  vim.cmd("enew")
  if vim.fn.has("nvim-0.11") == 1 then
    vim.fn.jobstart(argv, { term = true, cwd = vim.fn.getcwd() })
  else
    vim.fn.termopen(argv, { cwd = vim.fn.getcwd() })
  end
  vim.cmd("startinsert")
end

-- Runs argv in the background and shows what it prints in a scratch buffer.
function M.open_output(argv)
  vim.cmd(M.config.split)
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_win_set_buf(0, buf)
  vim.bo[buf].filetype = "markdown"
  local append = function(_, data)
    if data then vim.api.nvim_buf_set_lines(buf, -1, -1, false, data) end
  end
  vim.fn.jobstart(argv, { cwd = vim.fn.getcwd(), stdout_buffered = false, on_stdout = append, on_stderr = append })
end

-- The text a command was given, and, over a range, the selection around it.
local function request(opts)
  local text = opts.args or ""
  if opts.range > 0 then
    if text == "" then text = vim.fn.input("Concerto, for the selection: ") end
    return M.request_for(opts.line1, opts.line2, text)
  end
  return text
end

-- :Concerto [request] opens the TUI; over a selection it starts with that code and the request.
function M.build(opts)
  local text = request(opts)
  local argv = { M.config.cmd }
  if text ~= "" then table.insert(argv, text) end
  M.open_terminal(argv)
end

-- :ConcertoPlan [request]: the plan, scores and models, without building anything.
function M.plan(opts)
  local text = request(opts)
  if text == "" then return vim.notify("ConcertoPlan needs a request.", vim.log.levels.WARN) end
  M.open_output({ M.config.cmd, "--plan", "--explain", text })
end

return M
