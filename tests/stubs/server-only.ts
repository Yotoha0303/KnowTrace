// `server-only` 在 Next 打包时装成空模块并靠条件导出触发错误；单测里 vite 会解析到
// 默认入口（抛错版本），因此用别名把它替换成 no-op，让服务端模块可以直接被 import。
export {};
