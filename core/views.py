# core/views.py - FINALIZED and CORRECTED (Verified)

from functools import wraps
import json
from urllib.parse import urlparse, parse_qs
from rest_framework import viewsets, status, mixins
from rest_framework.response import Response
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.permissions import AllowAny, IsAuthenticated
from django.shortcuts import render, redirect
from django.contrib.auth import authenticate, login, logout
from django.http import JsonResponse, HttpResponseForbidden, HttpResponseNotFound, FileResponse
import mimetypes
from django.urls import reverse
from django.db import transaction, models
from django.db.utils import OperationalError
from django.db.models import Sum, Q, Count, OuterRef, Subquery
from .models import (
    User, Department, Student, Item, IssueRecord, PendingReport, ActivityLog,
    Enrollment, DepartmentItemRequirement, HelpThread, HelpMessage, Notification,
    InventoryOrder, InventoryReceipt, StockLogEntry
)
from .serializers import (
    UserSerializer, DepartmentSerializer, StudentSerializer,
    ItemSerializer, IssueRecordSerializer, PendingReportSerializer, ActivityLogSerializer,
    EnrollmentSerializer, DepartmentItemRequirementSerializer, HelpThreadSerializer,
    HelpMessageSerializer, NotificationSerializer, InventoryOrderSerializer,
    InventoryReceiptSerializer, StockLogEntrySerializer
)

# --- NEW: Helper mapping (Must match your Item model codes and Department model fields) ---
ITEM_FIELD_MAP = {
    '2PN': 'two_hundred_notebook',
    '2PR': 'two_hundred_record',
    '2PO': 'two_hundred_observation',
    '1PN': 'one_hundred_notebook',
    '1PR': 'one_hundred_record',
    '1PO': 'one_hundred_observation',
}
# -----------------------------------------------------------------------------------------
from time import sleep

from .constants import DEFAULT_SUPER_ADMIN_USERNAME
DB_LOCK_MAX_RETRIES = 3
DB_LOCK_RETRY_DELAY = 0.15


def _is_super_admin(user):
    if not user:
        return False
    if getattr(user, 'is_superuser', False):
        return True
    username = (getattr(user, 'username', '') or '').strip().lower()
    return username == DEFAULT_SUPER_ADMIN_USERNAME


def _super_admin_queryset():
    qs = User.objects.filter(is_superuser=True)
    if qs.exists():
        return qs
    return User.objects.filter(username__iexact=DEFAULT_SUPER_ADMIN_USERNAME)


def _role_redirect(user):
    if user.role == User.Role.ADMIN:
        return 'dashboard'
    return 'issue'


def _role_required(allowed_roles):
    def decorator(view_func):
        @wraps(view_func)
        def _wrapped(request, *args, **kwargs):
            if not request.user.is_authenticated:
                return redirect('login')
            if request.user.role not in allowed_roles:
                return redirect(_role_redirect(request.user))
            return view_func(request, *args, **kwargs)
        return _wrapped
    return decorator


# -------------------------------------------------
# Helper utilities for API responses / notifications
# -------------------------------------------------

def _ensure_api_auth(request):
    if not request.user.is_authenticated:
        return Response({"message": "Authentication required."}, status=status.HTTP_401_UNAUTHORIZED)
    return None


def _ensure_admin(request):
    if request.user.role != User.Role.ADMIN:
        return Response({"message": "Admin access required."}, status=status.HTTP_403_FORBIDDEN)
    return None


def _ensure_super_admin(request):
    if not _is_super_admin(request.user):
        return Response({"message": "Super admin access required."}, status=status.HTTP_403_FORBIDDEN)
    return None


def _notify_users(users, message, link=None, notification_type=None):
    recipients = list(users)
    for recipient in recipients:
        Notification.objects.create(
            recipient=recipient,
            message=message,
            link=link,
            notification_type=notification_type,
        )


def _get_or_create_help_thread(user):
    thread, _ = HelpThread.objects.get_or_create(user=user)
    return thread


def _serialize_user_summary(user):
    return {
        'id': user.id,
        'username': user.username,
        'email': user.email,
        'role': user.role,
        'approval_status': user.approval_status,
        'date_joined': user.date_joined,
    }


#=============================================================
# Web Page Views (Standard Django views for rendering HTML)
#=============================================================

def landing_view(request):
    return render(request, 'landing.html')


def login_page_view(request):
    if request.user.is_authenticated:
        return redirect(_role_redirect(request.user))
    role = request.GET.get('role')
    if role not in dict(User.Role.choices):
        role = User.Role.ADMIN
    return render(request, 'login.html', {'selected_role': role})


def register_page_view(request):
    if request.user.is_authenticated and request.user.role != User.Role.ADMIN:
        return redirect(_role_redirect(request.user))
    return render(request, 'register.html', {'roles': User.Role.choices})


@_role_required([User.Role.ADMIN])
def dashboard_view(request):
    return render(request, 'dashboard.html')


@_role_required([User.Role.ADMIN])
def students_view(request):
    return render(request, 'students.html')


@_role_required([User.Role.ADMIN])
def bulk_upload_view(request):
    return render(request, 'bulk_upload.html')


@_role_required([User.Role.ADMIN])
def department_view(request):
    return render(request, 'departments.html')


@_role_required([User.Role.ADMIN])
def items_view(request):
    return render(request, 'items.html')


@_role_required([User.Role.ADMIN, User.Role.STATIONERY])
def issue_view(request):
    return render(request, 'issue.html')


@_role_required([User.Role.ADMIN])
def pending_view(request):
    return render(request, 'pending.html')


@_role_required([User.Role.ADMIN, User.Role.STATIONERY])
def report_view(request):
    return render(request, 'report.html')


@_role_required([User.Role.ADMIN])
def manage_users_view(request):
    is_super = _is_super_admin(request.user)
    config = {
        "isSuperAdmin": is_super,
        "superAdminUsername": DEFAULT_SUPER_ADMIN_USERNAME,
    }
    context = {
        'is_super_admin': is_super,
        'super_admin_username': DEFAULT_SUPER_ADMIN_USERNAME,
        'manage_users_config': json.dumps(config),
    }
    return render(request, 'manage_users.html', context)


@_role_required([User.Role.ADMIN, User.Role.STATIONERY])
def help_center_view(request):
    return render(request, 'help_center.html')


#=============================================================
# API Views (Django REST Framework Views for Data/Auth)
#=============================================================

@api_view(['GET'])
@permission_classes([AllowAny])
def get_dashboard_data(request):
    total_departments = Department.objects.count()
    # Count per-year enrollments to reflect all imported rows
    try:
        from .models import Enrollment
        total_students = Enrollment.objects.count()
    except Exception:
        total_students = Student.objects.count()
    # Use aggregation for a more efficient count of unique issues, or sum of quantities
    total_issued = IssueRecord.objects.aggregate(total=Sum('qty_issued'))['total'] or 0
    
    # Calculate total books in hand (total inventory - total issued)
    total_inventory = Item.objects.aggregate(total=Sum('quantity'))['total'] or 0
    total_books_in_hand = max(0, total_inventory - total_issued)

    data = {
        'total_departments': total_departments,
        'total_students': total_students,
        'total_issued': total_issued,
        'total_pending': total_books_in_hand,  # Changed to show books in hand
    }
    return Response(data)

@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    username = request.data.get('username')
    password = request.data.get('password')
    requested_role = request.data.get('role')

    user = authenticate(username=username, password=password)

    if user is None:
        return Response({"message": "Invalid credentials"}, status=status.HTTP_400_BAD_REQUEST)

    if user.approval_status != User.ApprovalStatus.APPROVED:
        return Response({"message": "Your account is pending approval. Please wait for the administrator."}, status=status.HTTP_403_FORBIDDEN)

    if requested_role in dict(User.Role.choices) and requested_role != user.role:
        return Response({"message": "You are not authorized for this portal."}, status=status.HTTP_403_FORBIDDEN)

    login(request, user)
    redirect_url = reverse(_role_redirect(user))
    return Response({
        "message": "Login successful",
        "role": user.role,
        "redirect": redirect_url,
    })

@api_view(['POST'])
@permission_classes([AllowAny])
def logout_view(request):
    logout(request)
    return Response({"message": "Logout successful"}, status=status.HTTP_200_OK)

@api_view(['POST'])
@permission_classes([AllowAny])
def register_view(request):
    username = (request.data.get('username') or '').strip()
    password = request.data.get('password') or ''
    email = (request.data.get('email') or '').strip()
    requested_role = (request.data.get('role') or User.Role.STATIONERY).strip()

    if not username or not password or not email:
        return Response({"message": "Username, email, and password are required."}, status=status.HTTP_400_BAD_REQUEST)

    if len(password) < 4:
        return Response({"message": "Password must be at least 4 characters long."}, status=status.HTTP_400_BAD_REQUEST)

    if User.objects.filter(username__iexact=username).exists():
        return Response({"message": "Username already exists."}, status=status.HTTP_400_BAD_REQUEST)

    if User.objects.filter(email__iexact=email).exists():
        return Response({"message": "Email already exists."}, status=status.HTTP_400_BAD_REQUEST)

    if requested_role not in dict(User.Role.choices):
        requested_role = User.Role.STATIONERY

    user = User.objects.create_user(
        username=username,
        password=password,
        email=email,
        role=requested_role,
        approval_status=User.ApprovalStatus.PENDING,
    )

    admin_users = User.objects.filter(role=User.Role.ADMIN, approval_status=User.ApprovalStatus.APPROVED)
    _notify_users(
        admin_users,
        message=f"New user '{user.username}' registered for approval.",
        link=f"/manage-users/?user_id={user.id}",
        notification_type='user_signup'
    )

    return Response({
        "message": "Registration submitted for approval. Please wait for the admin to grant access.",
        "role": user.role,
        "approval_status": user.approval_status,
    }, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def pending_users(request):
    auth_error = _ensure_api_auth(request)
    if auth_error:
        return auth_error
    admin_error = _ensure_admin(request)
    if admin_error:
        return admin_error

    search = (request.GET.get('search') or '').strip()
    status_filter = request.GET.get('approval_status')

    queryset = User.objects.exclude(id=request.user.id)
    if search:
        queryset = queryset.filter(Q(username__icontains=search) | Q(email__icontains=search))
    if status_filter in dict(User.ApprovalStatus.choices):
        queryset = queryset.filter(approval_status=status_filter)

    data = [_serialize_user_summary(user) for user in queryset.order_by('-date_joined')]
    return Response(data, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def approve_user(request, user_id):
    auth_error = _ensure_api_auth(request)
    if auth_error:
        return auth_error
    admin_error = _ensure_admin(request)
    if admin_error:
        return admin_error

    action = (request.data.get('action') or '').strip().lower()
    message = (request.data.get('message') or '').strip()

    if action not in ['approve', 'reject', 'delete']:
        return Response({"message": "Invalid action."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({"message": "User not found."}, status=status.HTTP_404_NOT_FOUND)

    if _is_super_admin(user):
        return Response({"message": "You cannot change the main admin's status."}, status=status.HTTP_400_BAD_REQUEST)

    if user.id == request.user.id:
        return Response({"message": "You cannot change your own approval status."}, status=status.HTTP_400_BAD_REQUEST)

    if user.role == User.Role.ADMIN and not _is_super_admin(request.user):
        return Response({"message": "Only the main admin can manage admin accounts."}, status=status.HTTP_403_FORBIDDEN)

    if action == 'approve':
        user.approval_status = User.ApprovalStatus.APPROVED
        update_fields = ['approval_status']
        if user.role == User.Role.ADMIN:
            if not _is_super_admin(user):
                return Response({"message": "Only the designated super admin account can hold the admin role."}, status=status.HTTP_400_BAD_REQUEST)
        else:
            update_fields.append('role')
        user.save(update_fields=update_fields)
        thread = _get_or_create_help_thread(user)
        welcome_message = HelpMessage.objects.create(
            thread=thread,
            sender=request.user,
            content=message or "Welcome aboard! Your account is now active."
        )
        welcome_message.is_admin_read = True
        welcome_message.is_user_read = False
        welcome_message.save(update_fields=['is_admin_read', 'is_user_read'])
        target_link = '/issue/' if user.role == User.Role.STATIONERY else '/dashboard/'
        _notify_users([user], message="New welcome message from admin in Help Center.", link='/issue/?chat=open', notification_type='help_reply')
        _notify_users([user], message or "Your account has been approved.", notification_type='approval', link=target_link)
        Notification.objects.filter(notification_type='user_signup', link__icontains=f"user_id={user.id}").delete()
        response_message = "User approved successfully."
    else:
        username = user.username
        if action == 'reject':
            user.approval_status = User.ApprovalStatus.REJECTED
            user.save(update_fields=['approval_status'])
            Notification.objects.filter(notification_type='user_signup', link__icontains=f"user_id={user.id}").delete()
            response_message = "User marked as rejected."
            return Response({
                "message": response_message,
                "user": _serialize_user_summary(user),
                "show_delete": True,
                "user_id": user_id,
                "username": username,
            }, status=status.HTTP_200_OK)
        with transaction.atomic():
            user.delete()
        Notification.objects.filter(notification_type='user_signup', link__icontains=f"user_id={user_id}").delete()
        response_message = "User deleted successfully."
        return Response({
            "message": response_message,
            "deleted": True,
            "user_id": user_id,
            "username": username,
        }, status=status.HTTP_200_OK)

    return Response({"message": response_message, "user": _serialize_user_summary(user)}, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def fetch_notifications(request):
    auth_error = _ensure_api_auth(request)
    if auth_error:
        return auth_error

    notifications_qs = Notification.objects.filter(recipient=request.user).order_by('-created_at')
    unread_count = notifications_qs.filter(is_read=False).count()
    notifications = notifications_qs[:50]
    serializer = NotificationSerializer(notifications, many=True)
    return Response({'notifications': serializer.data, 'unread': unread_count}, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_help_threads(request):
    auth_error = _ensure_api_auth(request)
    if auth_error:
        return auth_error

    admin_error = _ensure_admin(request)
    if admin_error:
        return admin_error

    search = (request.GET.get('search') or '').strip()

    latest_message_qs = HelpMessage.objects.filter(
        thread_id=OuterRef('pk'),
        is_admin_deleted=False
    ).order_by('-created_at')

    threads_qs = HelpThread.objects.select_related('user').filter(
        user__approval_status=User.ApprovalStatus.APPROVED
    ).exclude(user__is_superuser=True)
    if _is_super_admin(request.user):
        threads_qs = threads_qs.exclude(user=request.user)
    threads_qs = threads_qs.annotate(
        last_message_at=Subquery(latest_message_qs.values('created_at')[:1]),
        unread_count=Count(
            'messages',
            filter=Q(messages__is_admin_read=False, messages__is_admin_deleted=False) & ~Q(messages__sender=request.user)
        )
    ).order_by('-last_message_at', '-updated_at')
    if search:
        threads_qs = threads_qs.filter(
            Q(user__username__icontains=search) |
            Q(user__email__icontains=search)
        )

    threads_data = []
    for thread in threads_qs:
        visible_messages = thread.messages.filter(is_admin_deleted=False)
        last_message = visible_messages.order_by('-created_at').first()
        unread_count = visible_messages.exclude(sender=request.user).filter(is_admin_read=False).count()
        threads_data.append({
            'thread_id': thread.id,
            'user_id': thread.user.id,
            'user_username': thread.user.username,
            'user_role': thread.user.role,
            'user_status': thread.user.approval_status,
            'last_message': last_message.content if last_message and last_message.content else '',
            'last_attachment_type': last_message.attachment_type if last_message else None,
            'last_message_at': last_message.created_at if last_message else None,
            'unread_count': unread_count,
            'updated_at': thread.updated_at,
        })

    return Response({'threads': threads_data}, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mark_notification_read(request, notification_id):
    auth_error = _ensure_api_auth(request)
    if auth_error:
        return auth_error

    try:
        notification = request.user.notifications.get(id=notification_id)
    except Notification.DoesNotExist:
        return Response({"message": "Notification not found."}, status=status.HTTP_404_NOT_FOUND)

    if notification.is_read:
        return Response({"message": "Notification already marked as read."}, status=status.HTTP_200_OK)

    notification.is_read = True
    notification.save(update_fields=['is_read'])

    return Response({"message": "Notification marked as read."}, status=status.HTTP_200_OK)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def delete_notification(request, notification_id):
    auth_error = _ensure_api_auth(request)
    if auth_error:
        return auth_error

    try:
        notification = request.user.notifications.get(id=notification_id)
    except Notification.DoesNotExist:
        return Response({"message": "Notification not found."}, status=status.HTTP_404_NOT_FOUND)

    allow_delete = True
    denial_message = None
    ntype = (notification.notification_type or '').strip()

    if ntype in {'user_signup'}:
        target_id = None
        link = notification.link or ''
        if link:
            try:
                parsed = urlparse(link)
                params = parse_qs(parsed.query)
                user_param = params.get('user_id') or params.get('user')
                if user_param:
                    target_id = int(user_param[0])
            except (ValueError, TypeError):
                target_id = None
        if target_id is not None:
            try:
                target_user = User.objects.get(id=target_id)
            except User.DoesNotExist:
                target_user = None
            if target_user and target_user.approval_status == User.ApprovalStatus.PENDING:
                allow_delete = False
                denial_message = "Please approve or reject this registration before dismissing the notification."

    if allow_delete and ntype in {'help_message', 'help_reply'} and not notification.is_read:
        allow_delete = False
        denial_message = "Read the chat message before dismissing this notification."

    if not allow_delete:
        return Response({"message": denial_message or "Notification cannot be dismissed yet."}, status=status.HTTP_409_CONFLICT)

    notification.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET', 'DELETE'])
@permission_classes([IsAuthenticated])
def get_help_thread(request):
    auth_error = _ensure_api_auth(request)
    if auth_error:
        return auth_error

    mark_read_param = (request.GET.get('mark_read') or '').strip().lower()
    mark_read = mark_read_param not in ('0', 'false', 'no') if mark_read_param else True

    if request.method == 'DELETE':
        if request.user.role != User.Role.ADMIN:
            return Response({"message": "Only admins can delete help center conversations."}, status=status.HTTP_403_FORBIDDEN)

        user_id = request.GET.get('user_id')
        if not user_id:
            return Response({"message": "Parameter 'user_id' is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            target_user = User.objects.get(id=user_id)
        except (User.DoesNotExist, ValueError):
            return Response({"message": "User not found."}, status=status.HTTP_404_NOT_FOUND)

        if target_user.approval_status != User.ApprovalStatus.APPROVED:
            return Response({"message": "User not found."}, status=status.HTTP_404_NOT_FOUND)

        thread = HelpThread.objects.filter(user=target_user).first()
        if not thread:
            Notification.objects.filter(notification_type__in=['help_message'], link__icontains=f"chat_user={target_user.id}").delete()
            return Response({"message": "Conversation already cleared."}, status=status.HTTP_200_OK)

        with transaction.atomic():
            thread.delete()
            Notification.objects.filter(notification_type__in=['help_message'], link__icontains=f"chat_user={target_user.id}").delete()

        return Response({"message": "Conversation deleted."}, status=status.HTTP_200_OK)

    target_user = request.user
    if request.user.role == User.Role.ADMIN:
        user_id = request.GET.get('user_id')
        if user_id:
            try:
                target_user = User.objects.get(id=user_id)
            except User.DoesNotExist:
                return Response({"message": "User not found."}, status=status.HTTP_404_NOT_FOUND)
            if target_user.approval_status == User.ApprovalStatus.REJECTED:
                return Response({"message": "User not found."}, status=status.HTTP_404_NOT_FOUND)
    if request.user.role == User.Role.ADMIN and target_user.approval_status != User.ApprovalStatus.APPROVED:
        return Response({"message": "User not found."}, status=status.HTTP_404_NOT_FOUND)

    thread = _get_or_create_help_thread(target_user)

    if request.user.role == User.Role.ADMIN:
        if mark_read:
            thread.messages.filter(is_admin_deleted=False).exclude(sender=request.user).filter(is_admin_read=False).update(is_admin_read=True)
            if target_user.id == request.user.id:
                Notification.objects.filter(
                    recipient=request.user,
                    notification_type='help_reply'
                ).update(is_read=True)
            else:
                Notification.objects.filter(
                    recipient=request.user,
                    notification_type='help_message',
                    link__icontains=f"chat_user={target_user.id}"
                ).update(is_read=True)
    else:
        if mark_read:
            thread.messages.filter(is_user_deleted=False).exclude(sender=request.user).filter(is_user_read=False).update(is_user_read=True)
            Notification.objects.filter(
                recipient=request.user,
                notification_type='help_reply'
            ).update(is_read=True)

    serializer = HelpThreadSerializer(thread, context={'request': request})

    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mark_help_thread_read(request):
    """Mark the help thread as read for the current actor without deleting it."""
    auth_error = _ensure_api_auth(request)
    if auth_error:
        return auth_error

    actor = request.user
    target_user = actor
    if actor.role == User.Role.ADMIN:
        user_id = request.data.get('user_id')
        if user_id:
            try:
                target_user = User.objects.get(id=user_id)
            except User.DoesNotExist:
                return Response({"message": "User not found."}, status=status.HTTP_404_NOT_FOUND)
            if target_user.approval_status != User.ApprovalStatus.APPROVED:
                return Response({"message": "User not found."}, status=status.HTTP_404_NOT_FOUND)

    thread = HelpThread.objects.filter(user=target_user).first()
    if not thread:
        return Response({"marked": 0, "unread": 0}, status=status.HTTP_200_OK)

    if actor.role == User.Role.ADMIN:
        updated = thread.messages.filter(is_admin_deleted=False).exclude(sender=actor).filter(is_admin_read=False).update(is_admin_read=True)
        Notification.objects.filter(
            recipient=actor,
            notification_type='help_message',
            link__icontains=f"chat_user={target_user.id}"
        ).delete()
        remaining = thread.messages.filter(is_admin_deleted=False).exclude(sender=actor).filter(is_admin_read=False).count()
    else:
        if thread.user_id != actor.id:
            return Response({"message": "User not found."}, status=status.HTTP_404_NOT_FOUND)
        updated = thread.messages.filter(is_user_deleted=False).exclude(sender=actor).filter(is_user_read=False).update(is_user_read=True)
        Notification.objects.filter(
            recipient=actor,
            notification_type='help_reply'
        ).delete()
        remaining = thread.messages.filter(is_user_deleted=False).exclude(sender=actor).filter(is_user_read=False).count()

    return Response({"marked": updated, "unread": remaining}, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def clear_help_thread(request):
    """Soft-delete the help thread for the actor only."""
    auth_error = _ensure_api_auth(request)
    if auth_error:
        return auth_error

    actor = request.user
    target_user = actor
    if actor.role == User.Role.ADMIN:
        user_id = request.data.get('user_id')
        if not user_id:
            return Response({"message": "user_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            target_user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response({"message": "User not found."}, status=status.HTTP_404_NOT_FOUND)
        if target_user.approval_status != User.ApprovalStatus.APPROVED:
            return Response({"message": "User not found."}, status=status.HTTP_404_NOT_FOUND)
    else:
        if request.data.get('user_id') and int(request.data.get('user_id')) != actor.id:
            return Response({"message": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)

    thread = HelpThread.objects.filter(user=target_user).first()
    if not thread:
        return Response({"cleared": 0}, status=status.HTTP_200_OK)

    if actor.role == User.Role.ADMIN:
        updated = thread.messages.filter(is_admin_deleted=False).update(is_admin_deleted=True)
        Notification.objects.filter(
            recipient=actor,
            notification_type='help_message',
            link__icontains=f"chat_user={target_user.id}"
        ).delete()
    else:
        if thread.user_id != actor.id:
            return Response({"message": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        updated = thread.messages.filter(is_user_deleted=False).update(is_user_deleted=True)
        Notification.objects.filter(
            recipient=actor,
            notification_type='help_reply'
        ).delete()

    return Response({"cleared": updated}, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def purge_orphan_help_notifications(request):
    auth_error = _ensure_api_auth(request)
    if auth_error:
        return auth_error

    base_qs = request.user.notifications.filter(notification_type__in=['help_message', 'help_reply'])
    if not base_qs.exists():
        return Response({'removed': 0}, status=status.HTTP_200_OK)

    is_super_admin = _is_super_admin(request.user)
    valid_user_ids = set(HelpThread.objects.values_list('user_id', flat=True))

    removable_ids = []
    for notification in base_qs.only('id', 'link'):
        link = notification.link or ''
        try:
            parsed = urlparse(link)
        except Exception:
            parsed = None
        if not parsed:
            removable_ids.append(notification.id)
            continue
        params = parse_qs(parsed.query)
        user_param = params.get('user_id') or params.get('chat_user')
        if not user_param:
            removable_ids.append(notification.id)
            continue
        try:
            target_id = int(user_param[0])
        except (TypeError, ValueError):
            removable_ids.append(notification.id)
            continue
        if notification.notification_type == 'help_reply':
            if target_id not in valid_user_ids:
                removable_ids.append(notification.id)
        else:  # help_message, intended for admins
            if is_super_admin:
                if target_id not in valid_user_ids:
                    removable_ids.append(notification.id)
            else:
                # normal admins should not keep help_message notifications
                removable_ids.append(notification.id)

    deleted_count, _ = Notification.objects.filter(id__in=removable_ids).delete()
    return Response({'removed': deleted_count}, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def post_help_message(request):
    auth_error = _ensure_api_auth(request)
    if auth_error:
        return auth_error

    content = (request.data.get('content') or '').strip()
    attachment_file = request.FILES.get('attachment')
    attachment_type = request.data.get('attachment_type')
    if not content and not attachment_file:
        return Response({"message": "Provide text or an attachment."}, status=status.HTTP_400_BAD_REQUEST)

    target_user = request.user
    if request.user.role == User.Role.ADMIN:
        user_id = request.data.get('user_id')
        if not user_id:
            return Response({"message": "user_id is required for admin replies."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            target_user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response({"message": "User not found."}, status=status.HTTP_404_NOT_FOUND)
        if target_user.approval_status != User.ApprovalStatus.APPROVED:
            return Response({"message": "User not found."}, status=status.HTTP_404_NOT_FOUND)

    thread = _get_or_create_help_thread(target_user if request.user.role == User.Role.ADMIN else request.user)
    message = HelpMessage(thread=thread, sender=request.user)
    message.content = content
    if attachment_file:
        message.attachment = attachment_file
        detected_type = None
        if attachment_type:
            detected_type = attachment_type
        else:
            mime = (getattr(attachment_file, 'content_type', '') or '').lower()
            if mime.startswith('audio'):
                detected_type = 'audio'
            elif mime.startswith('image'):
                detected_type = 'image'
            elif mime.startswith('video'):
                detected_type = 'video'
            elif mime in ('application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'):
                detected_type = 'document'
            elif mime:
                detected_type = 'file'
        message.attachment_type = detected_type
    message.save()

    if request.user.role == User.Role.ADMIN:
        message.is_user_read = False
        message.is_admin_read = True
        message.save(update_fields=['is_user_read', 'is_admin_read'])
        _notify_users([thread.user], message="New reply from admin in Help Center.", link='/issue/?chat=open', notification_type='help_reply')
    else:
        message.is_admin_read = False
        message.is_user_read = True
        message.save(update_fields=['is_user_read', 'is_admin_read'])
        admin_users = _super_admin_queryset().filter(approval_status=User.ApprovalStatus.APPROVED)
        if admin_users.exists():
            _notify_users(
                admin_users,
                message=f"Help center message from {request.user.username}.",
                link=f"/dashboard/?chat_user={request.user.id}",
                notification_type='help_message'
            )

    serializer = HelpMessageSerializer(message, context={'request': request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def delete_help_message(request, message_id):
    auth_error = _ensure_api_auth(request)
    if auth_error:
        return auth_error

    try:
        message = HelpMessage.objects.select_related('thread__user').get(pk=message_id)
    except HelpMessage.DoesNotExist:
        return Response({'message': 'Message not found.'}, status=status.HTTP_404_NOT_FOUND)

    user = request.user
    is_admin = getattr(user, 'role', None) == User.Role.ADMIN

    if is_admin:
        if message.is_admin_deleted:
            return Response(status=status.HTTP_204_NO_CONTENT)
        message.is_admin_deleted = True
        message.save(update_fields=['is_admin_deleted'])
        return Response(status=status.HTTP_204_NO_CONTENT)

    # Stationery/user side
    if message.thread.user_id != user.id:
        return Response({'message': 'Not allowed to delete this message.'}, status=status.HTTP_403_FORBIDDEN)

    if message.is_user_deleted:
        return Response(status=status.HTTP_204_NO_CONTENT)

    message.is_user_deleted = True
    message.save(update_fields=['is_user_deleted'])
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET'])
def help_attachment_preview(request, message_id):
    try:
        message = HelpMessage.objects.select_related('thread__user').get(pk=message_id)
    except HelpMessage.DoesNotExist:
        return HttpResponseNotFound('Attachment not found.')

    user = request.user
    is_admin = getattr(user, 'role', None) == User.Role.ADMIN
    if not user.is_authenticated:
        return HttpResponseForbidden('Authentication required.')

    if message.sender_id != user.id and message.thread.user_id != user.id and not is_admin:
        return HttpResponseForbidden('Not allowed to access this attachment.')

    if not message.attachment:
        return HttpResponseNotFound('Attachment missing.')

    attachment = message.attachment
    response = FileResponse(attachment.open('rb'), as_attachment=False)
    filename = attachment.name.split('/')[-1]
    mime_type = getattr(attachment, 'content_type', '') or mimetypes.guess_type(filename)[0] or 'application/octet-stream'
    response['Content-Type'] = mime_type
    response['Content-Disposition'] = f'inline; filename="{filename}"'
    return response
# --- API FUNCTION: BULK UPLOAD IMPLEMENTATION ---
@api_view(['POST'])
@permission_classes([AllowAny])
@transaction.atomic
def bulk_upload_api_view(request):
    """Handles bulk creation/update of student records from Excel/CSV data."""
    student_data_list = request.data # List of student objects from JS

    if not isinstance(student_data_list, list) or not student_data_list:
        return Response({"error": "Invalid or empty data list provided."},
                             status=status.HTTP_400_BAD_REQUEST)

    new_students = []
    seen_new_usns = set()
    created_count = 0
    updated_count = 0
    # 1. Build department indexes for robust matching
    #    - Exact index by (course_code, course, academic_year, year)
    #    - Index by (course_code, course, academic_year) -> list of depts (by year)
    #    - Fallback index by (course_code, course) with list of depts (choose latest academic_year)
    all_depts = Department.objects.all()
    dept_exact_full = {}
    depts_by_cc_ay = {}
    depts_by_cc_course = {}
    def normalize_ay(ay: str) -> str:
        """Normalize Academic Year strings broadly.
        - Trim and uppercase
        - Convert '/', unicode dashes to '-'
        - Remove spaces
        - Expand short end year: '2023-25' -> '2023-2025'
        """
        import re
        s = (ay or '').strip().upper()
        # Replace unicode dashes with '-'
        s = re.sub(r"[\u2010-\u2015\u2212]", '-', s)
        s = s.replace('/', '-').replace(' ', '')
        if '-' in s:
            parts = s.split('-')
            try:
                start = int(parts[0][:4])
                end = parts[1]
                if len(end) == 2 and end.isdigit():
                    end_full = int(str(start)[:2] + end)
                    return f"{start}-{end_full}"
            except Exception:
                pass
        return s

    def normalize_year(val: str) -> str:
        # Keep digits only; '01' -> '1'; 'I' -> '1' not supported, expect digits in sheet
        import re
        digits = ''.join(re.findall(r"\d+", (val or '').strip()))
        return str(int(digits)) if digits.isdigit() else (val or '').strip()
    for d in all_depts.order_by('id'):
        code_u = d.course_code.strip().upper()
        course_u = (d.course or '').strip().upper()
        ay_u = normalize_ay(d.academic_year)
        year_s = normalize_year(str(d.year) if d.year is not None else '')

        # Full exact key including year
        key_full = (code_u, course_u, ay_u, year_s)
        dept_exact_full[key_full] = d

        # Group by (code, course, ay)
        key_cc_ay = (code_u, course_u, ay_u)
        depts_by_cc_ay.setdefault(key_cc_ay, []).append(d)

        # Group by (code, course)
        key_pair = (code_u, course_u)
        depts_by_cc_course.setdefault(key_pair, []).append(d)

    # 3. Process each student record
    def parse_int(val):
        if val is None:
            return None
        try:
            s = str(val).strip()
            if not s:
                return None
            return int(float(s))
        except (ValueError, TypeError):
            return None

    for data in student_data_list:
        usn = str(data.get('usn', '')).strip().upper()
        name = str(data.get('name', '')).strip()
        course_code = str(data.get('course_code', '')).strip().upper()
        course = str(data.get('course', '')).strip().upper()
        year = normalize_year(str(data.get('year', '')).strip())
        academic_year = normalize_ay(str(data.get('academic_year', '')).strip())
        program_type = str(data.get('program_type', '')).strip()
        intake_val = parse_int(data.get('intake'))
        existing_val = parse_int(data.get('existing'))

        # Allow missing 'year' (it's optional on the model)
        if not usn or not name or not course_code or not course:
            continue

        # Resolve department with layered strategy
        dept = None
        ay_u = academic_year.upper()
        key_full = (course_code, course, ay_u, year)
        # 1) Full exact match including year
        dept = dept_exact_full.get(key_full)
        if not dept:
            # 2) Match within same (code, course, academic_year) on year
            group = depts_by_cc_ay.get((course_code, course, ay_u), [])
            if group:
                dept = next((g for g in group if str(g.year).strip() == year), None)
        if not dept:
            # 3) Try ignoring course casing differences: search any dept with same (code, course) for AY+year match
            candidates = depts_by_cc_course.get((course_code, course), [])
            if candidates:
                def ay_sort_key(d):
                    ay = normalize_ay(d.academic_year)
                    try:
                        first = int(ay.split('-')[0]) if '-' in ay else int(ay) if ay.isdigit() else 0
                    except Exception:
                        first = 0
                    return first
                candidates_sorted = sorted(candidates, key=ay_sort_key, reverse=True)
                # Prefer exact AY+year match within candidates
                dept = next((g for g in candidates_sorted if normalize_ay(g.academic_year) == ay_u and normalize_year(str(g.year)) == year), None)
                # If academic year provided, do not reuse different AY
                if not dept and ay_u:
                    dept = None
                if not dept and not ay_u:
                    dept = next((g for g in candidates_sorted if normalize_year(str(g.year)) == year), None)
                if not dept and not ay_u and candidates_sorted:
                    dept = candidates_sorted[0]
            else:
                # No candidates for this (code, course). Do not reuse mismatched academic years
                dept = None

        # 4) As a last resort, create a Department ONLY if none exists with same (code, ay, year)
        if not dept:
            # Double-check DB to avoid duplicates differing by course casing
            existing = Department.objects.filter(
                course_code__iexact=course_code,
                course__iexact=course,
                academic_year__iexact=academic_year,
                year__iexact=year
            ).order_by('id').first()
            if existing:
                dept = existing
            else:
                dept = Department.objects.create(
                    course_code=course_code,
                    course=course,
                    program_type=program_type or None,
                    academic_year=academic_year,
                    year=year or None,
                    intake=intake_val,
                    existing=existing_val
                )
                # Update in-memory indexes so subsequent rows reuse this department
                code_u = course_code
                course_u = course
                ay_u = academic_year
                year_s = year
                key_full = (code_u, course_u, ay_u, year_s)
                dept_exact_full[key_full] = dept
                key_cc_ay = (code_u, course_u, ay_u)
                depts_by_cc_ay.setdefault(key_cc_ay, []).append(dept)
                key_pair = (code_u, course_u)
                depts_by_cc_course.setdefault(key_pair, []).append(dept)

        if dept:
            dept_fields = {}
            if program_type and (dept.program_type or '').strip() != program_type:
                dept.program_type = program_type
                dept_fields['program_type'] = program_type
            if intake_val is not None and dept.intake != intake_val:
                dept.intake = intake_val
                dept_fields['intake'] = intake_val
            if existing_val is not None and dept.existing != existing_val:
                dept.existing = existing_val
                dept_fields['existing'] = existing_val
            if dept_fields:
                dept.save(update_fields=list(dept_fields.keys()))

        student_data = {
            'usn': usn,
            'name': name,
            'department': dept,
            'year': year,
            'email': str(data.get('email', '')).strip(),
            'phone': str(data.get('phone', '')).strip(),
        }

        # Update existing student if found; otherwise prepare for creation
        student = Student.objects.filter(usn=usn).first()
        if student:
            for key, value in student_data.items():
                setattr(student, key, value)
            student.save()
            updated_count += 1
        else:
            if usn not in seen_new_usns:
                new_students.append(Student(**student_data))
                seen_new_usns.add(usn)

    if new_students:
        # Extra safety: skip any remaining conflicts at DB level
        before = Student.objects.count()
        Student.objects.bulk_create(new_students, ignore_conflicts=True)
        after = Student.objects.count()
        created_count += max(0, after - before)

    # Ensure enrollments exist for all rows
    created_enrollments = 0
    updated_enrollments = 0
    for data in student_data_list:
        usn = str(data.get('usn', '')).strip().upper()
        course_code = str(data.get('course_code', '')).strip().upper()
        course = str(data.get('course', '')).strip().upper()
        year = normalize_year(str(data.get('year', '')).strip())
        academic_year = normalize_ay(str(data.get('academic_year', '')).strip())
        program_type = str(data.get('program_type', '')).strip()
        intake_val = parse_int(data.get('intake'))
        existing_val = parse_int(data.get('existing'))

        if not usn or not course_code or not course:
            continue

        # Resolve student and department again (using same layered logic as above)
        student = Student.objects.filter(usn=usn).first()
        if not student:
            continue

        ay_u = academic_year.upper()
        key_full = (course_code, course, ay_u, year)
        dept = None
        dept = dept_exact_full.get(key_full)
        if not dept:
            group = depts_by_cc_ay.get((course_code, course, ay_u), [])
            if group:
                dept = next((g for g in group if str(g.year).strip() == year), None)
        if not dept:
            candidates = depts_by_cc_course.get((course_code, course), [])
            if candidates:
                def ay_sort_key(d):
                    ay = normalize_ay(d.academic_year)
                    try:
                        first = int(ay.split('-')[0]) if '-' in ay else int(ay) if ay.isdigit() else 0
                    except Exception:
                        first = 0
                    return first
                candidates_sorted = sorted(candidates, key=ay_sort_key, reverse=True)
                dept = next((g for g in candidates_sorted if normalize_ay(g.academic_year) == ay_u and normalize_year(str(g.year)) == year), None)
                if not dept and not ay_u:
                    dept = next((g for g in candidates_sorted if normalize_year(str(g.year)) == year), None)
        if not dept:
            dept = Department.objects.filter(
                course_code__iexact=course_code,
                course__iexact=course,
                academic_year__iexact=academic_year,
                year__iexact=year
            ).order_by('id').first()
        if not dept:
            dept = Department.objects.create(
                course_code=course_code,
                course=course,
                program_type=program_type or None,
                academic_year=academic_year,
                year=year or None,
                intake=intake_val,
                existing=existing_val
            )
        else:
            dept_fields = {}
            if program_type and (dept.program_type or '').strip() != program_type:
                dept.program_type = program_type
                dept_fields['program_type'] = program_type
            if intake_val is not None and dept.intake != intake_val:
                dept.intake = intake_val
                dept_fields['intake'] = intake_val
            if existing_val is not None and dept.existing != existing_val:
                dept.existing = existing_val
                dept_fields['existing'] = existing_val
            if dept_fields:
                dept.save(update_fields=list(dept_fields.keys()))

        # Upsert Enrollment
        enrollment, created = Enrollment.objects.get_or_create(
            student=student,
            department=dept,
            academic_year=normalize_ay(academic_year or (dept.academic_year or '')),
            year=normalize_year(year or '')
        )
        if created:
            created_enrollments += 1
    
    # Log the bulk upload activity
    ActivityLog.objects.create(
        action='bulk_upload',
        description=(
            f'Bulk upload completed. Students - Created: {created_count}, Updated: {updated_count}; '
            f'Enrollments - Created: {created_enrollments}; Received rows: {len(student_data_list)}'
        )
    )

    return Response({
        "message": "Bulk upload completed.",
        "created": created_count,
        "updated": updated_count,
        "created_enrollments": created_enrollments,
        "received": len(student_data_list),
    }, status=status.HTTP_200_OK)
# -----------------------------------------------------------------------------

# --- Dynamic Requirements: Backfill from legacy Department fields ---
@api_view(['POST'])
@permission_classes([AllowAny])
def backfill_requirements(request):
    """Create Items for legacy codes if missing and populate DepartmentItemRequirement.
    Non-destructive: repeats safely.
    """
    # Ensure base items exist
    legacy_items = [
        ('2PN', '200 Pages Note Book'),
        ('2PR', '200 Pages Record'),
        ('2PO', '200 Pages Observation'),
        ('1PN', '100 Pages Note Book'),
        ('1PR', '100 Pages Record'),
        ('1PO', '100 Pages Observation'),
    ]
    created_items = 0
    for code, name in legacy_items:
        obj, created = Item.objects.get_or_create(item_code=code, defaults={'name': name, 'quantity': 0})
        if created:
            created_items += 1

    # Backfill requirements per department
    created_reqs = 0
    updated_reqs = 0
    for dept in Department.objects.all():
        for code, field in ITEM_FIELD_MAP.items():
            req_qty = getattr(dept, field, 0) or 0
            try:
                item = Item.objects.get(item_code=code)
            except Item.DoesNotExist:
                continue
            req, created = DepartmentItemRequirement.objects.get_or_create(department=dept, item=item, defaults={'required_qty': req_qty})
            if created:
                created_reqs += 1
            else:
                # Keep existing value if already set; update only when different and legacy has value
                if req_qty is not None and req.required_qty != req_qty:
                    req.required_qty = req_qty
                    req.save()
                    updated_reqs += 1

    return Response({
        'items_created': created_items,
        'requirements_created': created_reqs,
        'requirements_updated': updated_reqs
    }, status=status.HTTP_200_OK)


# --- Dynamic Requirements: Retrieve for a cohort ---
@api_view(['GET'])
@permission_classes([AllowAny])
def get_requirements(request):
    code = (request.GET.get('course_code') or '').strip()
    course = (request.GET.get('course') or '').strip()
    ay = (request.GET.get('academic_year') or '').strip()
    year = (request.GET.get('year') or '').strip()

    if not (code and course and ay and year):
        return Response({'error': 'Provide course_code, course, academic_year, and year.'}, status=status.HTTP_400_BAD_REQUEST)

    dept = Department.objects.filter(
        course_code__iexact=code,
        course__iexact=course,
        academic_year__iexact=ay,
        year__iexact=year
    ).first()
    if not dept:
        return Response({'department_id': None, 'requirements': []}, status=status.HTTP_200_OK)

    qs = DepartmentItemRequirement.objects.filter(department=dept).select_related('item').order_by('item__item_code')
    data = DepartmentItemRequirementSerializer(qs, many=True).data
    return Response({'department_id': dept.id, 'requirements': data}, status=status.HTTP_200_OK)


# --- Dynamic Requirements: Bulk update for a cohort ---
@api_view(['PUT'])
@permission_classes([AllowAny])
def update_requirements(request):
    payload = request.data or {}
    dept_id = payload.get('department_id')
    reqs = payload.get('requirements', [])
    if not dept_id or not isinstance(reqs, list):
        return Response({'error': 'department_id and requirements[] are required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        dept = Department.objects.get(id=dept_id)
    except Department.DoesNotExist:
        return Response({'error': 'Department not found'}, status=status.HTTP_404_NOT_FOUND)

    upserted = 0
    for r in reqs:
        code = (r.get('item_code') or '').strip() or None
        item_id = r.get('item_id')
        qty = r.get('required_qty')
        try:
            qty = int(qty)
            if qty < 0:
                qty = 0
        except Exception:
            qty = 0

        item = None
        if item_id:
            item = Item.objects.filter(id=item_id).first()
        if not item and code:
            item = Item.objects.filter(item_code__iexact=code).first()
        if not item:
            # Optionally auto-create when code+name provided
            name = (r.get('item_name') or code or '').strip()
            if code:
                item = Item.objects.create(item_code=code, name=name, quantity=0)
            else:
                continue

        obj, created = DepartmentItemRequirement.objects.update_or_create(
            department=dept, item=item, defaults={'required_qty': qty}
        )
        upserted += 1

    return Response({'upserted': upserted}, status=status.HTTP_200_OK)


# --- API FUNCTION: To fetch all student records for Issue page ---
@api_view(['GET'])
@permission_classes([AllowAny])
def get_student_records(request, usn):
    """
    Fetch issued records and calculate pending based on the correct cohort.
    If query params include course_code, course, academic_year, and year,
    try to find a matching Enrollment/Department and use its required quantities.
    Otherwise fall back to the student's base department.
    """
    try:
        student = Student.objects.select_related('department').get(usn=usn)
    except Student.DoesNotExist:
        return Response({"error": "Student not found."}, status=status.HTTP_404_NOT_FOUND)

    base_department = student.department
    if not base_department:
        return Response({"error": "Student has no department assigned."}, status=status.HTTP_400_BAD_REQUEST)

    # Normalize AY helper
    import re
    def norm_ay(s: str) -> str:
        s = (s or '').strip()
        s = re.sub(r"[\u2010-\u2015\u2212]", '-', s)
        return s

    # Attempt to pick department from Enrollment based on query params
    code = (request.GET.get('course_code') or '').strip()
    course = (request.GET.get('course') or '').strip()
    ay = norm_ay(request.GET.get('academic_year') or '')
    year = (request.GET.get('year') or '').strip()

    picked_department = None
    if code or course or ay or year:
        # Search student's enrollments for a match
        enrollments = Enrollment.objects.select_related('department').filter(student=student)
        for e in enrollments:
            d = e.department
            if not d:
                continue
            if code and (d.course_code or '').strip() != code:
                continue
            if course and (d.course or '').strip() != course:
                continue
            if year and str(e.year) != str(year):
                continue
            if ay and norm_ay(e.academic_year) != ay:
                continue
            picked_department = d
            break

    department = picked_department or base_department

    # 1. Get Issued Records (Aggregated by item_code) scoped to cohort when provided
    issued_qs = IssueRecord.objects.filter(student=student)
    if ay:
        issued_qs = issued_qs.filter(academic_year__iexact=ay)
    if year:
        issued_qs = issued_qs.filter(year=str(year))
    issued_data_qs = issued_qs.values('item_code').annotate(
        total_qty=Sum('qty_issued')
    )
    issued_map = {item['item_code']: item['total_qty'] for item in issued_data_qs}

    # 2. Prepare Detailed Issued List 
    detailed_issued_qs = issued_qs.order_by('date_issued')
    detailed_issued_data = IssueRecordSerializer(detailed_issued_qs, many=True).data

    # 3. Calculate Pending Quantities using selected department
    pending_map = {}
    for item_code, dept_field in ITEM_FIELD_MAP.items():
        required_qty = getattr(department, dept_field, 0) or 0
        issued_qty = issued_map.get(item_code, 0) or 0
        pending_qty = max(0, required_qty - issued_qty)
        pending_map[item_code] = pending_qty

    return Response({
        "issued": detailed_issued_data,
        "pending": pending_map
    }, status=status.HTTP_200_OK)
# -----------------------------------------------------------------------------


#=============================================================
# ViewSets (CRUD operations for models)
#=============================================================

class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer
    permission_classes = [AllowAny]

class DepartmentViewSet(viewsets.ModelViewSet):
    queryset = Department.objects.all()
    serializer_class = DepartmentSerializer
    permission_classes = [AllowAny]
    
    def perform_create(self, serializer):
        department = serializer.save()
        # Log the activity
        ActivityLog.objects.create(
            action='department_added',
            description=f'Added department: {department.course_code} - {department.course}'
        )
    
    def perform_update(self, serializer):
        department = serializer.save()
        # Log the activity
        ActivityLog.objects.create(
            action='department_edited',
            description=f'Edited department: {department.course_code} - {department.course}'
        )
    
    def perform_destroy(self, instance):
        # Log before deleting
        ActivityLog.objects.create(
            action='department_deleted',
            description=f'Deleted department: {instance.course_code} - {instance.course}'
        )
        instance.delete()

class StudentViewSet(viewsets.ModelViewSet):
    queryset = Student.objects.select_related('department').all()
    serializer_class = StudentSerializer
    permission_classes = [AllowAny]
    lookup_field = 'usn'
    
    def perform_create(self, serializer):
        student = serializer.save()
        # Log the activity
        ActivityLog.objects.create(
            action='student_added',
            description=f'Added student: {student.usn} - {student.name}'
        )
        try:
            dept = student.department
            if dept:
                import re
                def n_ay(s: str) -> str:
                    s = (s or '').strip().upper()
                    s = re.sub(r"[\u2010-\u2015\u2212]", '-', s).replace('/', '-').replace(' ', '')
                    if '-' in s:
                        parts = s.split('-')
                        try:
                            start = int(parts[0][:4])
                            end = parts[1]
                            if len(end) == 2 and end.isdigit():
                                end_full = int(str(start)[:2] + end)
                                return f"{start}-{end_full}"
                        except Exception:
                            pass
                    return s
                def n_year(v: str) -> str:
                    import re as _re
                    digits = ''.join(_re.findall(r"\d+", (v or '').strip()))
                    return str(int(digits)) if digits.isdigit() else (v or '').strip()
                ay = n_ay(dept.academic_year)
                yr = n_year(str(student.year))
                if ay and yr:
                    Enrollment.objects.get_or_create(
                        student=student,
                        department=dept,
                        academic_year=ay,
                        year=yr
                    )
        except Exception:
            pass
    
    def perform_update(self, serializer):
        student = serializer.save()
        # Log the activity
        ActivityLog.objects.create(
            action='student_edited',
            description=f'Edited student: {student.usn} - {student.name}'
        )
        try:
            dept = student.department
            if dept:
                import re
                def n_ay(s: str) -> str:
                    s = (s or '').strip().upper()
                    s = re.sub(r"[\u2010-\u2015\u2212]", '-', s).replace('/', '-').replace(' ', '')
                    if '-' in s:
                        parts = s.split('-')
                        try:
                            start = int(parts[0][:4])
                            end = parts[1]
                            if len(end) == 2 and end.isdigit():
                                end_full = int(str(start)[:2] + end)
                                return f"{start}-{end_full}"
                        except Exception:
                            pass
                    return s
                def n_year(v: str) -> str:
                    import re as _re
                    digits = ''.join(_re.findall(r"\d+", (v or '').strip()))
                    return str(int(digits)) if digits.isdigit() else (v or '').strip()
                ay = n_ay(dept.academic_year)
                yr = n_year(str(student.year))
                if ay and yr:
                    Enrollment.objects.get_or_create(
                        student=student,
                        department=dept,
                        academic_year=ay,
                        year=yr
                    )
        except Exception:
            pass

    def destroy(self, request, *args, **kwargs):
        try:
            student = self.get_object()
        except Exception:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        
        # Log before deleting
        ActivityLog.objects.create(
            action='student_deleted',
            description=f'Deleted student: {student.usn} - {student.name}'
        )

        self.perform_destroy(student)
        return Response(status=status.HTTP_204_NO_CONTENT)

class ItemViewSet(viewsets.ModelViewSet):
    queryset = Item.objects.all()
    serializer_class = ItemSerializer
    permission_classes = [AllowAny]
    
    def perform_create(self, serializer):
        item = serializer.save()
        # Log the activity
        ActivityLog.objects.create(
            action='books_issued',
            description=f'Added inventory item: {item.item_code} - {item.name} (Qty: {item.quantity})'
        )
    
    def perform_update(self, serializer):
        item = serializer.save()
        # Log the activity
        ActivityLog.objects.create(
            action='books_issued',
            description=f'Updated inventory: {item.item_code} - {item.name} (Qty: {item.quantity})'
        )
    
    def perform_destroy(self, instance):
        # Log before deleting
        ActivityLog.objects.create(
            action='books_issued',
            description=f'Deleted inventory item: {instance.item_code} - {instance.name}'
        )
        instance.delete()

class IssueRecordViewSet(viewsets.ModelViewSet):
    queryset = IssueRecord.objects.all()
    serializer_class = IssueRecordSerializer
    permission_classes = [AllowAny]

    # CRITICAL FIX: Custom create method for bulk issuance and inventory management
    def create(self, request, *args, **kwargs):
        from django.db import IntegrityError
        from django.db.models import Q
        try:
            data = request.data
            student_usn = data.get('student_usn')
            issues = data.get('issues', [])

            if not student_usn or not isinstance(issues, list) or len(issues) == 0:
                return Response({"error": "Missing student_usn or issues list."}, status=status.HTTP_400_BAD_REQUEST)

            student_id = Student.objects.filter(usn=student_usn).values_list('id', flat=True).first()
            if not student_id:
                return Response({"error": f"Student with USN {student_usn} not found."}, status=status.HTTP_404_NOT_FOUND)

            saved_records = []

            def perform_issue_transaction():
                # Use an explicit atomic transaction we can catch at commit time
                with transaction.atomic():
                    saved_records_local = []
                    # Cohort from request (optional)
                    req_code = (data.get('course_code') or '').strip()
                    req_course = (data.get('course') or '').strip()
                    req_ay = (data.get('academic_year') or '').strip()
                    req_year = (data.get('year') or '').strip()
                    # Helper to infer cohort if not fully provided
                    def infer_cohort():
                        try:
                            stu = Student.objects.select_related('department').get(id=student_id)
                            q = Enrollment.objects.select_related('department').filter(student=stu)
                            if req_code:
                                q = q.filter(department__course_code=req_code)
                            if req_course:
                                q = q.filter(department__course=req_course)
                            if req_ay:
                                q = q.filter(academic_year__iexact=req_ay)
                            if req_year:
                                q = q.filter(year=str(req_year))
                            # Prefer exact year match, else earliest year
                            if req_year:
                                enr = q.first()
                            else:
                                enr = q.order_by('year').first()
                            if enr:
                                return enr.academic_year, str(enr.year)
                        except Exception:
                            pass
                        return None, None
                    cohort_ay, cohort_year = req_ay, req_year
                    if not cohort_ay or not cohort_year:
                        ay_i, yr_i = infer_cohort()
                        cohort_ay = cohort_ay or ay_i
                        cohort_year = cohort_year or yr_i
                    # Normalize AY dashes before saving
                    try:
                        import re as _re
                        def _norm(s: str) -> str:
                            return _re.sub(r"[\u2010-\u2015\u2212]", '-', (s or '').strip())
                        cohort_ay = _norm(cohort_ay)
                    except Exception:
                        pass
                    for issue in issues:
                        item_code = (issue.get('item_code') or '').strip()
                        try:
                            quantity = int(issue.get('quantity', 0) or 0)
                        except (TypeError, ValueError):
                            quantity = 0
                        remarks = issue.get('remarks')

                        if not item_code or quantity <= 0:
                            continue

                        try:
                            inventory_item = Item.objects.get(item_code__iexact=item_code)
                        except Item.DoesNotExist:
                            return None, Response({"error": f"Inventory item code {item_code} not found."}, status=status.HTTP_404_NOT_FOUND)

                        if inventory_item.quantity < quantity:
                            return None, Response({"error": f"Insufficient stock for {item_code}. Available: {inventory_item.quantity}, Requested: {quantity}"}, status=status.HTTP_400_BAD_REQUEST)

                        inventory_item.quantity -= quantity
                        inventory_item.save()

                        if isinstance(remarks, str) and len(remarks) > 255:
                            remarks = remarks[:255]

                        record = IssueRecord(
                            student_id=student_id,
                            item_code=item_code,
                            qty_issued=quantity,
                            status='Issued',
                            remarks=remarks,
                            academic_year=cohort_ay,
                            year=cohort_year
                        )
                        record.save()
                        saved_records_local.append(record)

                    return saved_records_local, None

            # First attempt
            saved_records, early_response = perform_issue_transaction()
            if early_response is not None:
                return early_response

            if saved_records is None:
                saved_records = []

            created_records_data = IssueRecordSerializer(saved_records, many=True).data
            
            # Log the book issue activity
            total_books = sum(record.qty_issued for record in saved_records)
            ActivityLog.objects.create(
                action='books_issued',
                description=f'Issued {total_books} books to student {student_usn}'
            )
            
            return Response(created_records_data, status=status.HTTP_201_CREATED)

        except IntegrityError as e:
            # Attempt one-time cleanup of orphaned foreign keys in PendingReport and retry
            try:
                existing_student_ids = set(Student.objects.values_list('id', flat=True))
                orphans = PendingReport.objects.exclude(student_id__in=existing_student_ids)
                if orphans.exists():
                    orphans.delete()

                # Retry once after cleanup
                saved_records, early_response = perform_issue_transaction()
                if early_response is not None:
                    return early_response
                if saved_records is None:
                    saved_records = []
                created_records_data = IssueRecordSerializer(saved_records, many=True).data
                
                # Log the book issue activity
                total_books = sum(record.qty_issued for record in saved_records)
                ActivityLog.objects.create(
                    action='books_issued',
                    description=f'Issued {total_books} books to student {student_usn}'
                )
                
                return Response(created_records_data, status=status.HTTP_201_CREATED)
            except Exception:
                pass
            return Response({"error": f"Database integrity error during issue: {str(e)}"}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response({"error": f"Server error during issue: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class PendingReportViewSet(viewsets.ModelViewSet):
    queryset = PendingReport.objects.all()
    serializer_class = PendingReportSerializer
    permission_classes = [AllowAny]


class InventoryOrderViewSet(viewsets.ModelViewSet):
    queryset = InventoryOrder.objects.select_related('item', 'ordered_by').prefetch_related('receipts').all()
    serializer_class = InventoryOrderSerializer
    permission_classes = [IsAuthenticated]

    def perform_create(self, serializer):
        order = serializer.save(ordered_by=self.request.user)
        StockLogEntry.objects.create(
            item=order.item,
            change=0,
            pending_delta=order.pending_qty,
            reason=f"Order placed ({order.reference or 'no ref'})",
            previous_quantity=order.item.quantity,
            new_quantity=order.item.quantity,
            created_by=self.request.user,
            order=order
        )

    def perform_update(self, serializer):
        instance = serializer.save()
        instance.refresh_status()
        instance.save(update_fields=['status', 'received_qty', 'updated_at'])

    @action(detail=True, methods=['post'], url_path='receive')
    def receive(self, request, pk=None):
        qty = int(request.data.get('quantity', 0))
        note = (request.data.get('note') or '').strip() or None
        if qty <= 0:
            return Response({'error': 'Quantity must be greater than zero.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            order = InventoryOrder.objects.select_for_update().select_related('item').get(pk=self.get_object().pk)
            if qty > order.pending_qty:
                return Response({'error': 'Quantity exceeds pending amount.'}, status=status.HTTP_400_BAD_REQUEST)

            pending_before = order.pending_qty
            item = order.item
            previous_qty = item.quantity

            receipt = InventoryReceipt.objects.create(
                order=order,
                item=item,
                quantity=qty,
                note=note,
                received_by=request.user
            )

            order.received_qty += qty
            order.refresh_status()
            order.save(update_fields=['received_qty', 'status', 'updated_at'])
            order.refresh_from_db()

            item.quantity += qty
            item.save(update_fields=['quantity'])
            item.refresh_from_db(fields=['quantity'])

            pending_after = order.pending_qty

            StockLogEntry.objects.create(
                item=item,
                change=qty,
                pending_delta=pending_after - pending_before,
                reason='Received from order',
                previous_quantity=previous_qty,
                new_quantity=item.quantity,
                created_by=request.user,
                order=order,
                receipt=receipt
            )

        data = {
            'order': InventoryOrderSerializer(order, context={'request': request}).data,
            'receipt': InventoryReceiptSerializer(receipt, context={'request': request}).data
        }
        return Response(data, status=status.HTTP_201_CREATED)


class InventoryReceiptViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    queryset = InventoryReceipt.objects.select_related('item', 'order', 'received_by').all()
    serializer_class = InventoryReceiptSerializer
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['post'], url_path='consume')
    def consume(self, request):
        item_id = request.data.get('item_id') or request.data.get('item') or request.data.get('item_pk')
        try:
            quantity = int(request.data.get('quantity', 0))
        except (TypeError, ValueError):
            quantity = 0
        if not item_id or quantity <= 0:
            return Response({'error': 'item_id and positive quantity are required.'}, status=status.HTTP_400_BAD_REQUEST)

        consumed_state = {'amount': 0, 'partial': False, 'none': False}

        def perform_consume():
            receipts = InventoryReceipt.objects.select_for_update().filter(item_id=item_id).order_by('received_at')
            remaining = quantity
            consumed_local = 0
            for receipt in receipts:
                available = receipt.available_qty
                try:
                    available_int = int(available)
                except (TypeError, ValueError):
                    available_int = 0
                if available_int <= 0:
                    continue
                take = min(available_int, remaining)
                if take <= 0:
                    continue
                receipt.consumed_qty = models.F('consumed_qty') + take
                receipt.save(update_fields=['consumed_qty'])
                remaining -= take
                consumed_local += take
                if remaining <= 0:
                    break
            consumed_state['amount'] = consumed_local
            if consumed_local <= 0:
                consumed_state['none'] = True
                transaction.set_rollback(True)
            elif consumed_local < quantity:
                consumed_state['partial'] = True
                transaction.set_rollback(True)

        for attempt in range(DB_LOCK_MAX_RETRIES):
            try:
                with transaction.atomic():
                    perform_consume()
                break
            except OperationalError:
                if attempt == DB_LOCK_MAX_RETRIES - 1:
                    return Response({'error': 'Database is busy. Please retry shortly.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
                sleep(DB_LOCK_RETRY_DELAY)

        if consumed_state['none']:
            return Response({'error': 'Not enough received stock available.'}, status=status.HTTP_400_BAD_REQUEST)
        if consumed_state['partial']:
            return Response({'error': 'Only part of the requested stock could be consumed.'}, status=status.HTTP_409_CONFLICT)

        data = self.get_serializer(self.get_queryset(), many=True).data
        return Response(data, status=status.HTTP_200_OK)

    @action(detail=False, methods=['post'], url_path='restore')
    def restore(self, request):
        item_id = request.data.get('item_id') or request.data.get('item') or request.data.get('item_pk')
        try:
            quantity = int(request.data.get('quantity', 0))
        except (TypeError, ValueError):
            quantity = 0
        if not item_id or quantity <= 0:
            return Response({'error': 'item_id and positive quantity are required.'}, status=status.HTTP_400_BAD_REQUEST)

        restored_state = {'amount': 0, 'none': False, 'partial': False}

        def perform_restore():
            receipts = InventoryReceipt.objects.select_for_update().filter(item_id=item_id).order_by('-received_at')
            remaining = quantity
            restored_local = 0
            for receipt in receipts:
                used = receipt.consumed_qty or 0
                try:
                    used_int = int(used)
                except (TypeError, ValueError):
                    used_int = 0
                if used_int <= 0:
                    continue
                give_back = min(used_int, remaining)
                if give_back <= 0:
                    continue
                receipt.consumed_qty = models.F('consumed_qty') - give_back
                receipt.save(update_fields=['consumed_qty'])
                remaining -= give_back
                restored_local += give_back
                if remaining <= 0:
                    break
            restored_state['amount'] = restored_local
            if restored_local <= 0:
                restored_state['none'] = True
                transaction.set_rollback(True)
            elif restored_local < quantity:
                restored_state['partial'] = True

        for attempt in range(DB_LOCK_MAX_RETRIES):
            try:
                with transaction.atomic():
                    perform_restore()
                break
            except OperationalError:
                if attempt == DB_LOCK_MAX_RETRIES - 1:
                    return Response({'error': 'Database is busy. Please retry shortly.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
                sleep(DB_LOCK_RETRY_DELAY)

        if restored_state['none']:
            return Response({'error': 'No consumed stock available to restore.'}, status=status.HTTP_400_BAD_REQUEST)
        if restored_state['partial']:
            data = {
                'receipts': self.get_serializer(self.get_queryset(), many=True).data,
                'restored_amount': restored_state['amount'],
                'requested_amount': quantity
            }
            return Response(data, status=status.HTTP_206_PARTIAL_CONTENT)

        return Response(self.get_serializer(self.get_queryset(), many=True).data, status=status.HTTP_200_OK)


class StockLogEntryViewSet(viewsets.ModelViewSet):
    queryset = StockLogEntry.objects.select_related('item', 'created_by', 'order', 'receipt').all()
    serializer_class = StockLogEntrySerializer
    permission_classes = [IsAuthenticated]

    def perform_create(self, serializer):
        pending_delta = serializer.validated_data.get('pending_delta') or 0
        item = serializer.validated_data['item']
        change = serializer.validated_data['change']
        apply_change = serializer.validated_data.pop('apply_change', True)
        previous_qty = item.quantity
        if apply_change:
            new_qty = max(0, previous_qty + change)
            item.quantity = new_qty
            item.save(update_fields=['quantity'])
        else:
            new_qty = previous_qty
        serializer.save(
            previous_quantity=previous_qty,
            new_quantity=new_qty,
            pending_delta=pending_delta,
            created_by=self.request.user
        )

    @action(detail=False, methods=['delete'], url_path='clear')
    def clear(self, request):
        with transaction.atomic():
            deleted_count, _ = StockLogEntry.objects.all().delete()
        return Response({'deleted': deleted_count}, status=status.HTTP_200_OK)

class ActivityLogViewSet(viewsets.ModelViewSet):
    serializer_class = ActivityLogSerializer
    permission_classes = [AllowAny]

    def get_queryset(self):
        # Return last 20 activity logs, ordered by most recent
        return ActivityLog.objects.all().order_by('-timestamp')[:20]

class EnrollmentViewSet(viewsets.ModelViewSet):
    queryset = Enrollment.objects.select_related('student', 'department').all()
    serializer_class = EnrollmentSerializer
    permission_classes = [AllowAny]

@api_view(['POST'])
@permission_classes([AllowAny])
def backfill_enrollments(request):
    try:
        created = 0
        for s in Student.objects.select_related('department').all():
            dept = s.department
            if not dept:
                continue
            import re
            def n_ay(x: str) -> str:
                x = (x or '').strip().upper()
                x = re.sub(r"[\u2010-\u2015\u2212]", '-', x).replace('/', '-').replace(' ', '')
                if '-' in x:
                    parts = x.split('-')
                    try:
                        start = int(parts[0][:4])
                        end = parts[1]
                        if len(end) == 2 and end.isdigit():
                            end_full = int(str(start)[:2] + end)
                            return f"{start}-{end_full}"
                    except Exception:
                        pass
                return x
            def n_year(v: str) -> str:
                import re as _re
                digits = ''.join(_re.findall(r"\d+", (v or '').strip()))
                return str(int(digits)) if digits.isdigit() else (v or '').strip()
            ay = n_ay(dept.academic_year)
            yr = n_year(str(s.year))
            if not ay or not yr:
                continue
            obj, was_created = Enrollment.objects.get_or_create(
                student=s,
                department=dept,
                academic_year=ay,
                year=yr
            )
            if was_created:
                created += 1
        ActivityLog.objects.create(action='enrollment_backfill', description=f'Backfilled enrollments: {created}')
        return Response({"created": created}, status=status.HTTP_200_OK)
    except Exception as e:
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

@api_view(['POST'])
@permission_classes([AllowAny])
def purge_student_data(request):
    """Delete all Students, Enrollments, PendingReports, and IssueRecords.
    Keeps Departments and Items intact.
    """
    try:
        # Gather counts pre-deletion for response transparency
        counts_before = {
            "students": Student.objects.count(),
            "enrollments": Enrollment.objects.count(),
            "pending_reports": PendingReport.objects.count(),
            "issue_records": IssueRecord.objects.count(),
            "departments": Department.objects.count(),
            "items": Item.objects.count(),
        }

        # Delete in safe order to avoid FK issues
        Enrollment.objects.all().delete()
        IssueRecord.objects.all().delete()
        PendingReport.objects.all().delete()
        Student.objects.all().delete()

        counts_after = {
            "students": Student.objects.count(),
            "enrollments": Enrollment.objects.count(),
            "pending_reports": PendingReport.objects.count(),
            "issue_records": IssueRecord.objects.count(),
            "departments": Department.objects.count(),
            "items": Item.objects.count(),
        }

        ActivityLog.objects.create(
            action='purge_students',
            description='Purged students, enrollments, pending reports, and issue records.'
        )

        return Response({
            "message": "Student-related data purged successfully.",
            "before": counts_before,
            "after": counts_after
        }, status=status.HTTP_200_OK)
    except Exception as e:
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
@api_view(['POST'])
@permission_classes([AllowAny])
def generate_pending_reports_view(request):
    """
    Generate PendingReport per Enrollment (distinct per Academic Year and Year),
    using the Department quantities for that enrollment's department.
    """
    try:
        created_count = 0
        enrollments = Enrollment.objects.select_related('student', 'department').all()
        for enr in enrollments:
            student = enr.student
            dept = enr.department
            if not student or not dept:
                continue
            # Upsert: if report exists for this AY+Year, UPDATE quantities and meta
            report, created = PendingReport.objects.update_or_create(
                student=student,
                academic_year=enr.academic_year,
                year=enr.year,
                defaults={
                    'usn': student.usn,
                    'name': student.name,
                    'course': dept.course,
                    'course_code': dept.course_code,
                    'pn2': getattr(dept, 'two_hundred_notebook', 0) or 0,
                    'pr2': getattr(dept, 'two_hundred_record', 0) or 0,
                    'po2': getattr(dept, 'two_hundred_observation', 0) or 0,
                    'pn1': getattr(dept, 'one_hundred_notebook', 0) or 0,
                    'pr1': getattr(dept, 'one_hundred_record', 0) or 0,
                    'po1': getattr(dept, 'one_hundred_observation', 0) or 0,
                }
            )
            if created:
                created_count += 1

        if created_count > 0:
            ActivityLog.objects.create(
                action='pending_generated',
                description=f'Generated pending reports: {created_count} (per enrollment)'
            )

        return Response({
            "message": f"Generated {created_count} pending reports successfully.",
            "created_count": created_count
        }, status=status.HTTP_200_OK)

    except Exception as e:
        return Response({
            "error": f"Failed to generate pending reports: {str(e)}"
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)