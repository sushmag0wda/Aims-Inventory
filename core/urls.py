# core/urls.py (Application Level - FINALIZED)

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

# --- REST Framework Router Setup ---
router = DefaultRouter()
router.register(r'departments', views.DepartmentViewSet)
router.register(r'students', views.StudentViewSet, basename='student') 
router.register(r'items', views.ItemViewSet) # <-- This creates /api/items/ and /api/items/<pk>/
router.register(r'issue-records', views.IssueRecordViewSet)
router.register(r'pending-reports', views.PendingReportViewSet)
router.register(r'users', views.UserViewSet)
router.register(r'activity-logs', views.ActivityLogViewSet, basename='activity-log')
router.register(r'enrollments', views.EnrollmentViewSet, basename='enrollment')
router.register(r'inventory-orders', views.InventoryOrderViewSet, basename='inventory-order')
router.register(r'inventory-receipts', views.InventoryReceiptViewSet, basename='inventory-receipt')
router.register(r'stock-logs', views.StockLogEntryViewSet, basename='stock-log')


urlpatterns = [
    # ----------------------------------------------------
    # CORE API ENDPOINTS 
    
    path('api/login/', views.login_view, name='api-login'),
    path('api/logout/', views.logout_view, name='api-logout'),
    path('api/register/', views.register_view, name='api-register'),
    path('api/users/pending/', views.pending_users, name='api-users-pending'),
    path('api/users/<int:user_id>/approve/', views.approve_user, name='api-user-approve'),
    path('api/notifications/', views.fetch_notifications, name='api-notifications'),
    path('api/notifications/<int:notification_id>/read/', views.mark_notification_read, name='api-notification-read'),
    path('api/notifications/<int:notification_id>/', views.delete_notification, name='api-notification-delete'),
    path('api/help-notifications/purge/', views.purge_orphan_help_notifications, name='api-help-notifications-purge'),
    path('media/help-attachments/<int:message_id>/', views.help_attachment_preview, name='help-attachment-preview'),
    path('api/help-threads/', views.list_help_threads, name='api-help-threads'),
    path('api/help-thread/', views.get_help_thread, name='api-help-thread'),
    path('api/help-thread/mark-read/', views.mark_help_thread_read, name='api-help-thread-mark-read'),
    path('api/help-thread/clear/', views.clear_help_thread, name='api-help-thread-clear'),
    path('api/help-thread/messages/', views.post_help_message, name='api-help-message'),
    path('api/help-thread/messages/<int:message_id>/', views.delete_help_message, name='api-help-message-delete'),
    path('api/issue-bulk-create/', views.IssueRecordViewSet.as_view({'post': 'create'}), name='api-issue-bulk-create'),
    path('api/student-records/<str:usn>/', views.get_student_records, name='api-student-records'),
    path('api/dashboard-summary/', views.get_dashboard_data, name='api-dashboard-summary'),
    path('api/generate-pending-reports/', views.generate_pending_reports_view, name='api-generate-pending-reports'),
    path('api/backfill-enrollments/', views.backfill_enrollments, name='api-backfill-enrollments'),
    path('api/purge-students/', views.purge_student_data, name='api-purge-students'),
    # Dynamic requirements endpoints
    path('api/backfill-requirements/', views.backfill_requirements, name='api-backfill-requirements'),
    path('api/requirements/', views.get_requirements, name='api-get-requirements'),
    path('api/requirements/update/', views.update_requirements, name='api-update-requirements'),
    # Auth endpoints removed for no-auth mode
    path('api/students/bulk_upload/', views.bulk_upload_api_view, name='api-bulk-upload'), 
    
    # REST Framework ViewSet URLs (General CRUD paths)
    path('api/', include(router.urls)),
    
    # ----------------------------------------------------
    # HTML PAGE VIEWS (No authentication required)
    # ----------------------------------------------------
    path('', views.landing_view, name='home'), 
    path('login/', views.login_page_view, name='login'),
    path('register/', views.register_page_view, name='register'),
    path('dashboard/', views.dashboard_view, name='dashboard'),
    path('manage-users/', views.manage_users_view, name='manage-users'),
    path('students/', views.students_view, name='students'),
    path('departments/', views.department_view, name='departments'),
    path('items/', views.items_view, name='items'),
    path('issue/', views.issue_view, name='issue'),
    path('pending/', views.pending_view, name='pending'), 
    path('bulk-upload/', views.bulk_upload_view, name='bulk-upload'),
    path('report/', views.report_view, name='report'),
]