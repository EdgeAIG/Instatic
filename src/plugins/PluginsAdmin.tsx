import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "@ui/components/Button";
import { PowerIcon } from "@ui/icons/icons/power";
import { PowerOffIcon } from "@ui/icons/icons/power-off";
import { DeleteIcon } from "@ui/icons/icons/delete";
import { UploadIcon } from "@ui/icons/icons/upload";
import type {
  CmsPluginsPayload,
  InstalledPlugin,
  PluginManifest,
} from "@core/plugin-sdk";
import {
  collectEnabledAdminPages,
  parsePluginManifest,
  permissionLabel,
} from "@core/extensions/manifest";
import { permissionDescription } from "@core/plugin-sdk";
import {
  inspectCmsPluginPackage,
  installCmsPluginPackage,
  installCmsPluginManifest,
  listCmsPlugins,
  removeCmsPlugin,
  setCmsPluginEnabled,
} from "@core/persistence";
import EditorLayout from "../app/EditorLayout";
import { SettingsButton } from "../editor/components/Toolbar/SettingsButton";
import { notifyCmsPluginsChanged } from "./pluginEvents";
import styles from "./PluginsAdmin.module.css";

const emptyPayload: CmsPluginsPayload = { plugins: [], adminPages: [] };

interface PendingInstall {
  manifest: PluginManifest;
  file?: File;
}

function updatePlugin(
  payload: CmsPluginsPayload,
  plugin: InstalledPlugin,
): CmsPluginsPayload {
  const existing = payload.plugins.findIndex(
    (candidate) => candidate.id === plugin.id,
  );
  const plugins =
    existing === -1
      ? [plugin, ...payload.plugins]
      : payload.plugins.map((candidate) =>
          candidate.id === plugin.id ? plugin : candidate,
        );
  const adminPages = collectEnabledAdminPages(plugins);
  return { plugins, adminPages };
}

function pluginStatus(plugin: InstalledPlugin): {
  label: string;
  status: string;
} {
  const status =
    plugin.lifecycleStatus ?? (plugin.enabled ? "active" : "disabled");
  if (status === "error") return { label: "Error", status };
  if (status === "installed") return { label: "Installed", status };
  if (status === "disabled" || !plugin.enabled)
    return { label: "Disabled", status: "disabled" };
  return { label: "Active", status: "active" };
}

export function PluginsAdmin() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [payload, setPayload] = useState<CmsPluginsPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [busyPluginId, setBusyPluginId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingInstall, setPendingInstall] = useState<PendingInstall | null>(
    null,
  );

  async function loadPlugins() {
    setLoading(true);
    setError(null);
    try {
      setPayload(await listCmsPlugins());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load plugins");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPlugins();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      const manifest = file.name.toLowerCase().endsWith(".zip")
        ? await inspectCmsPluginPackage(file)
        : parsePluginManifest(JSON.parse(await file.text()));

      if (manifest.permissions.length > 0) {
        setPendingInstall({
          manifest,
          file: file.name.toLowerCase().endsWith(".zip") ? file : undefined,
        });
      } else {
        await installPendingPlugin(
          {
            manifest,
            file: file.name.toLowerCase().endsWith(".zip") ? file : undefined,
          },
          [],
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not install plugin");
    } finally {
      setUploading(false);
    }
  }

  async function installPendingPlugin(
    pending: PendingInstall,
    grantedPermissions = pending.manifest.permissions,
  ) {
    setUploading(true);
    setError(null);
    try {
      const result = pending.file
        ? await installCmsPluginPackage(pending.file, grantedPermissions)
        : await installCmsPluginManifest(pending.manifest, grantedPermissions);
      if (result.plugins.length > 0) {
        setPayload({ plugins: result.plugins, adminPages: result.adminPages });
      } else if (result.plugin) {
        setPayload((current) =>
          updatePlugin(current, result.plugin as InstalledPlugin),
        );
      } else {
        await loadPlugins();
      }
      notifyCmsPluginsChanged();
      setPendingInstall(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not install plugin");
    } finally {
      setUploading(false);
    }
  }

  async function togglePlugin(plugin: InstalledPlugin) {
    setBusyPluginId(plugin.id);
    setError(null);
    try {
      const result = await setCmsPluginEnabled(plugin.id, !plugin.enabled);
      if (result.plugins.length > 0) {
        setPayload({ plugins: result.plugins, adminPages: result.adminPages });
      } else if (result.plugin) {
        setPayload((current) =>
          updatePlugin(current, result.plugin as InstalledPlugin),
        );
      }
      notifyCmsPluginsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update plugin");
    } finally {
      setBusyPluginId(null);
    }
  }

  async function removePlugin(plugin: InstalledPlugin) {
    setBusyPluginId(plugin.id);
    setError(null);
    try {
      await removeCmsPlugin(plugin.id);
      setPayload((current) => ({
        plugins: current.plugins.filter(
          (candidate) => candidate.id !== plugin.id,
        ),
        adminPages: current.adminPages.filter(
          (page) => page.pluginId !== plugin.id,
        ),
      }));
      notifyCmsPluginsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove plugin");
    } finally {
      setBusyPluginId(null);
    }
  }

  const toolbarRightSlot = (
    <>
      <Button
        variant="primary"
        size="sm"
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
      >
        <UploadIcon size={14} aria-hidden="true" />
        <span>{uploading ? "Uploading" : "Upload Plugin"}</span>
      </Button>
      <SettingsButton />
    </>
  );

  return (
    <EditorLayout
      workspace="plugins"
      toolbarRightSlot={toolbarRightSlot}
      contentCanvas={
        <main
          className={styles.pluginsCanvas}
          data-testid="plugins-admin-canvas"
        >
          <section
            className={styles.pluginsShell}
            aria-labelledby="plugins-title"
          >
            <header className={styles.pluginsHeader}>
              <div className={styles.titleGroup}>
                <div>
                  <h1 id="plugins-title">Plugins</h1>
                  <p>
                    Install admin extensions and control what they add to the
                    CMS.
                  </p>
                </div>
              </div>
              <Button
                variant="primary"
                size="md"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadIcon size={15} aria-hidden="true" />
                <span>{uploading ? "Uploading" : "Upload Plugin"}</span>
              </Button>
              <input
                ref={fileInputRef}
                className={styles.fileInput}
                aria-label="Plugin file"
                type="file"
                accept="application/json,.json,.plugin.json,.pbplugin,.zip,application/zip"
                onChange={(event) => void handleUpload(event)}
              />
            </header>

            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}

            {pendingInstall && (
              <section
                className={styles.permissionReview}
                aria-labelledby="plugin-permissions-title"
              >
                <div>
                  <h2 id="plugin-permissions-title">
                    Approve Plugin Permissions
                  </h2>
                  <p>
                    {pendingInstall.manifest.name} requests access before
                    activation.
                  </p>
                </div>
                <ul>
                  {pendingInstall.manifest.permissions.map((permission) => (
                    <li key={permission}>
                      <strong>{permissionLabel(permission)}</strong>
                      <span>{permissionDescription(permission)}</span>
                    </li>
                  ))}
                </ul>
                <div className={styles.permissionActions}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPendingInstall(null)}
                  >
                    <span>Cancel</span>
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={uploading}
                    onClick={() => void installPendingPlugin(pendingInstall)}
                  >
                    <span>
                      {uploading ? "Installing" : "Approve and Install"}
                    </span>
                  </Button>
                </div>
              </section>
            )}

            <div className={styles.pluginsList} aria-label="Installed plugins">
              {loading ? (
                <p className={styles.emptyState}>Loading plugins...</p>
              ) : payload.plugins.length === 0 ? (
                <p className={styles.emptyState}>No plugins installed yet.</p>
              ) : (
                payload.plugins.map((plugin) => {
                  const status = pluginStatus(plugin);
                  return (
                    <article key={plugin.id} className={styles.pluginCard}>
                      <div className={styles.pluginMeta}>
                        <div className={styles.pluginNameRow}>
                          <h2>{plugin.name}</h2>
                          <span data-status={status.status}>
                            {status.label}
                          </span>
                        </div>
                        <p>
                          {plugin.manifest.description ??
                            `${plugin.id} v${plugin.version}`}
                        </p>
                        {plugin.lastError && (
                          <p className={styles.pluginError}>
                            {plugin.lastError}
                          </p>
                        )}
                        {plugin.manifest.adminPages.length > 0 && (
                          <div className={styles.pageLinks}>
                            {plugin.manifest.adminPages.map((page) => (
                              <Link key={page.id} to={page.route}>
                                {page.navLabel ?? page.title}
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className={styles.pluginActions}>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busyPluginId === plugin.id}
                          onClick={() => void togglePlugin(plugin)}
                          aria-label={`${plugin.enabled ? "Disable" : "Enable"} ${plugin.name}`}
                        >
                          {plugin.enabled ? (
                            <PowerOffIcon size={14} aria-hidden="true" />
                          ) : (
                            <PowerIcon size={14} aria-hidden="true" />
                          )}
                          <span>{plugin.enabled ? "Disable" : "Enable"}</span>
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={busyPluginId === plugin.id}
                          onClick={() => void removePlugin(plugin)}
                          aria-label={`Remove ${plugin.name}`}
                        >
                          <DeleteIcon size={14} aria-hidden="true" />
                          <span>Remove</span>
                        </Button>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>
        </main>
      }
    />
  );
}
