# Concerto for Neovim

Two commands, for Neovim 0.9 or newer with `concerto` on the PATH:

- `:Concerto [request]` opens Concerto in a terminal split. Over a visual selection
  (`:'<,'>Concerto add input validation`), the request starts with the file, the line numbers and
  the selected code.
- `:ConcertoPlan [request]` shows the plan, with why each story got its score and model, without
  building anything. It also works over a selection.

Install with any plugin manager, from the `editors/nvim` folder of this repository. With
lazy.nvim:

```lua
{ "RemiPelloux/Concerto", config = function(plugin)
    vim.opt.rtp:append(plugin.dir .. "/editors/nvim")
    require("concerto").setup({ split = "botright vsplit" })
  end }
```

`setup` takes `cmd` (default `concerto`) and `split` (any split command, default
`botright vsplit`).
