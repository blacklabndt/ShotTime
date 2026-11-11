// Windows host for DICONDE Editor: shows the editor (app\index.html) in Edge WebView2 and gives it native
// Open/Save dialogs. The editor never overwrites the file it opened; every save is a new file.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace DicondeEditor
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm(args.Length > 0 ? args[0] : null));
        }
    }

    sealed class MainForm : Form
    {
        const string Host = "diconde-editor.local";
        static readonly Uri StartUri = new Uri("https://" + Host + "/index.html");
        readonly WebView2 web = new WebView2 { Dock = DockStyle.Fill };
        readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        string pendingFile;       // file given on the command line ("Open with", double-click)
        string openedPath;        // the file the editor is showing; never overwritten
        readonly HashSet<string> originals = new HashSet<string>(StringComparer.OrdinalIgnoreCase); // every file opened; never overwritten
        bool dirty, allowClose;

        public MainForm(string file)
        {
            pendingFile = file;
            Text = "DICONDE Editor";
            Size = new Size(1400, 900);
            MinimumSize = new Size(800, 560);
            StartPosition = FormStartPosition.CenterScreen;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { /* default icon */ }
            Controls.Add(web);
            Load += async (s, e) => await InitAsync();
            FormClosing += OnFormClosing;
        }

        async Task InitAsync()
        {
            try
            {
                string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DICONDE Editor", "WebView2");
                var env = await CoreWebView2Environment.CreateAsync(null, data);
                await web.EnsureCoreWebView2Async(env);
            }
            catch (WebView2RuntimeNotFoundException)
            {
                MessageBox.Show(this, "DICONDE Editor needs the Microsoft Edge WebView2 Runtime, which is part of Windows 10 and 11.\n\n" +
                    "It can be installed from Microsoft: https://go.microsoft.com/fwlink/p/?LinkId=2124703", "WebView2 Runtime missing", MessageBoxButtons.OK, MessageBoxIcon.Error);
                allowClose = true; Close(); return;
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "The editor could not start: " + ex.Message, "DICONDE Editor", MessageBoxButtons.OK, MessageBoxIcon.Error);
                allowClose = true; Close(); return;
            }
            var core = web.CoreWebView2;
            string appDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app");
            core.SetVirtualHostNameToFolderMapping(Host, appDir, CoreWebView2HostResourceAccessKind.DenyCors);
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsZoomControlEnabled = false; // Ctrl+wheel belongs to the image viewer
            core.NewWindowRequested += (s, e) => e.Handled = true;
            core.NavigationStarting += (s, e) => { if (!e.Uri.StartsWith("https://" + Host + "/", StringComparison.OrdinalIgnoreCase)) e.Cancel = true; };
            core.WebMessageReceived += OnWebMessage;
            web.Source = StartUri;
        }

        // Messages from the page: { id?, cmd, ... }. Replies carry the same id.
        void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            Dictionary<string, object> m;
            try { m = json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson); } catch { return; }
            string cmd = Get(m, "cmd");
            object id = m.ContainsKey("id") ? m["id"] : null;
            try
            {
                switch (cmd)
                {
                    case "ready": if (pendingFile != null) { SendFile("openFile", null, pendingFile); pendingFile = null; } break;
                    case "open": Open(id); break;
                    case "save": Save(id, m); break;
                    case "openMany": OpenMany(id); break;
                    case "openFolder": OpenFolder(id); break;
                    case "pickFolder": PickFolder(id, Get(m, "near")); break;
                    case "writeFile": WriteFile(id, m); break;
                    case "dirty": dirty = Get(m, "dirty") == "True"; break;
                    case "title": Text = string.IsNullOrEmpty(Get(m, "text")) ? "DICONDE Editor" : Get(m, "text") + " - DICONDE Editor"; break;
                }
            }
            catch (Exception ex) { Reply(id, new Dictionary<string, object> { { "ok", false }, { "error", ex.Message } }); }
        }

        static string Get(Dictionary<string, object> m, string k) => m.TryGetValue(k, out var v) && v != null ? Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture) : "";

        void Open(object id)
        {
            using (var dlg = new OpenFileDialog { Title = "Open DICONDE file", Filter = "DICOM / DICONDE files (*.dcm;*.dicom;*.dic)|*.dcm;*.dicom;*.dic|All files (*.*)|*.*", CheckFileExists = true })
            {
                if (openedPath != null) dlg.InitialDirectory = Path.GetDirectoryName(openedPath);
                if (dlg.ShowDialog(this) != DialogResult.OK) { Reply(id, new Dictionary<string, object> { { "ok", false }, { "cancelled", true } }); return; }
                SendFile(null, id, dlg.FileName);
            }
        }

        void SendFile(string cmd, object id, string path)
        {
            var info = new FileInfo(path);
            if (!info.Exists) { MessageBox.Show(this, "File not found: " + path, "DICONDE Editor"); return; }
            if (info.Length > 1L << 30) { MessageBox.Show(this, "The file is larger than 1 GB.", "DICONDE Editor"); return; }
            var msg = new Dictionary<string, object> { { "ok", true }, { "name", info.Name }, { "path", info.FullName }, { "data", Convert.ToBase64String(File.ReadAllBytes(path)) } };
            if (cmd != null) msg["cmd"] = cmd;
            if (id != null) msg["id"] = id;
            if (cmd != "addShot") openedPath = info.FullName;
            originals.Add(info.FullName);
            web.CoreWebView2.PostWebMessageAsJson(json.Serialize(msg));
        }

        // Shots window: several files, or every .dcm file in a folder, sent one message per file.
        void OpenMany(object id)
        {
            using (var dlg = new OpenFileDialog { Title = "Add shots", Multiselect = true, Filter = "DICOM / DICONDE files (*.dcm;*.dicom;*.dic)|*.dcm;*.dicom;*.dic|All files (*.*)|*.*", CheckFileExists = true })
            {
                if (dlg.ShowDialog(this) != DialogResult.OK) { Reply(id, new Dictionary<string, object> { { "ok", false }, { "cancelled", true } }); return; }
                SendShots(id, dlg.FileNames);
            }
        }

        void OpenFolder(object id)
        {
            using (var dlg = new FolderBrowserDialog { Description = "Choose a folder of shots (.dcm files)", ShowNewFolderButton = false })
            {
                if (dlg.ShowDialog(this) != DialogResult.OK) { Reply(id, new Dictionary<string, object> { { "ok", false }, { "cancelled", true } }); return; }
                var files = new List<string>();
                foreach (var pattern in new[] { "*.dcm", "*.dicom", "*.dic" }) files.AddRange(Directory.GetFiles(dlg.SelectedPath, pattern, SearchOption.TopDirectoryOnly));
                files.Sort(StringComparer.OrdinalIgnoreCase);
                if (files.Count == 0) { Reply(id, new Dictionary<string, object> { { "ok", false }, { "error", "No .dcm files in that folder." } }); return; }
                SendShots(id, files.ToArray());
            }
        }

        void SendShots(object id, string[] paths)
        {
            int sent = 0;
            foreach (var p in paths) { try { SendFile("addShot", null, p); sent++; } catch (Exception ex) { MessageBox.Show(this, Path.GetFileName(p) + ": " + ex.Message, "DICONDE Editor"); } }
            web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new Dictionary<string, object> { { "cmd", "addShotsDone" }, { "count", sent } }));
            Reply(id, new Dictionary<string, object> { { "ok", true }, { "count", sent } });
        }

        void PickFolder(object id, string near)
        {
            using (var dlg = new FolderBrowserDialog { Description = "Choose where to save the edited copies", ShowNewFolderButton = true })
            {
                try { if (!string.IsNullOrEmpty(near) && File.Exists(near)) dlg.SelectedPath = Path.GetDirectoryName(near); } catch { }
                if (dlg.ShowDialog(this) != DialogResult.OK) { Reply(id, new Dictionary<string, object> { { "ok", false }, { "cancelled", true } }); return; }
                Reply(id, new Dictionary<string, object> { { "ok", true }, { "folder", dlg.SelectedPath } });
            }
        }

        // Writes one copy into the chosen folder. Never overwrites an opened original or an existing file:
        // a free name is found instead (name_2.dcm, name_3.dcm, ...).
        void WriteFile(object id, Dictionary<string, object> m)
        {
            string folder = Get(m, "folder"), name = Path.GetFileName(Get(m, "name"));
            if (string.IsNullOrEmpty(folder) || !Directory.Exists(folder) || string.IsNullOrEmpty(name)) throw new IOException("Folder or file name missing.");
            string stem = Path.GetFileNameWithoutExtension(name), ext = Path.GetExtension(name), target = Path.Combine(folder, name);
            for (int i = 2; File.Exists(target) || originals.Contains(Path.GetFullPath(target)); i++) target = Path.Combine(folder, stem + "_" + i + ext);
            string tmp = target + ".saving";
            File.WriteAllBytes(tmp, Convert.FromBase64String(Get(m, "data")));
            File.Move(tmp, target);
            Reply(id, new Dictionary<string, object> { { "ok", true }, { "path", target }, { "name", Path.GetFileName(target) } });
        }

        void Save(object id, Dictionary<string, object> m)
        {
            string name = Path.GetFileName(Get(m, "name"));
            string ext = Path.GetExtension(name).ToLowerInvariant();
            string filter = ext == ".zip" ? "ZIP archive (*.zip)|*.zip" : ext == ".png" ? "PNG image (*.png)|*.png" : ext == ".tif" ? "TIFF image (*.tif)|*.tif" : ext == ".pdf" ? "PDF document (*.pdf)|*.pdf" : "DICONDE file (*.dcm)|*.dcm";
            using (var dlg = new SaveFileDialog { Title = "Save", FileName = name, Filter = filter + "|All files (*.*)|*.*", OverwritePrompt = true, AddExtension = true, DefaultExt = ext.TrimStart('.') })
            {
                if (openedPath != null) dlg.InitialDirectory = Path.GetDirectoryName(openedPath);
                while (true)
                {
                    if (dlg.ShowDialog(this) != DialogResult.OK) { Reply(id, new Dictionary<string, object> { { "ok", false }, { "cancelled", true } }); return; }
                    if (openedPath != null && string.Equals(Path.GetFullPath(dlg.FileName), openedPath, StringComparison.OrdinalIgnoreCase))
                    {
                        MessageBox.Show(this, "That is the original file, which DICONDE Editor never overwrites. Choose a different name.", "Save", MessageBoxButtons.OK, MessageBoxIcon.Information);
                        continue;
                    }
                    break;
                }
                byte[] bytes = Convert.FromBase64String(Get(m, "data"));
                string tmp = dlg.FileName + ".saving";
                File.WriteAllBytes(tmp, bytes);           // write fully, then move into place
                if (File.Exists(dlg.FileName)) File.Delete(dlg.FileName);
                File.Move(tmp, dlg.FileName);
                Reply(id, new Dictionary<string, object> { { "ok", true }, { "path", dlg.FileName }, { "name", Path.GetFileName(dlg.FileName) } });
            }
        }

        void Reply(object id, Dictionary<string, object> msg)
        {
            if (id == null || web.CoreWebView2 == null) return;
            msg["id"] = id;
            web.CoreWebView2.PostWebMessageAsJson(json.Serialize(msg));
        }

        void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (allowClose || !dirty) return;
            var r = MessageBox.Show(this, "There are unsaved changes. Close without saving a copy?", "DICONDE Editor", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
            if (r != DialogResult.Yes) e.Cancel = true;
        }
    }
}
