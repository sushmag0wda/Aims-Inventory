# core/serializers.py (FINALIZED)
from rest_framework import serializers
from .models import (
    User, Department, Student, Item, IssueRecord, PendingReport, ActivityLog,
    Enrollment, DepartmentItemRequirement, HelpThread, HelpMessage, Notification,
    InventoryOrder, InventoryReceipt, StockLogEntry
)

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ('id', 'username', 'email', 'role', 'approval_status', 'date_joined')
        read_only_fields = ('approval_status', 'date_joined')

class DepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = (
            'id', 'course_code', 'course', 'academic_year', 'program_type', 'year',
            'intake', 'existing', 
            'two_hundred_notebook', 'two_hundred_record', 'two_hundred_observation',
            'one_hundred_notebook', 'one_hundred_record', 'one_hundred_observation',
            'total'
        )

    def to_internal_value(self, data):
        numerical_fields = [
            'intake', 'existing', 
            'two_hundred_notebook', 'two_hundred_record', 'two_hundred_observation',
            'one_hundred_notebook', 'one_hundred_record', 'one_hundred_observation',
            'total'
        ]
        
        for key in numerical_fields:
            if key in data and data[key] == '':
                data[key] = None
        
        return super().to_internal_value(data)

class StudentSerializer(serializers.ModelSerializer):
    department = DepartmentSerializer(read_only=True) 
    department_id = serializers.PrimaryKeyRelatedField(
        queryset=Department.objects.all(), source='department', write_only=True
    )
    
    class Meta:
        model = Student
        fields = ('id', 'usn', 'name', 'department', 'department_id', 'year', 'email', 'phone')

class StudentBasicSerializer(serializers.ModelSerializer):
    class Meta:
        model = Student
        fields = ('id', 'usn', 'name', 'email', 'phone')

class EnrollmentSerializer(serializers.ModelSerializer):
    student = StudentBasicSerializer(read_only=True)
    student_id = serializers.PrimaryKeyRelatedField(queryset=Student.objects.all(), source='student', write_only=True)
    department = DepartmentSerializer(read_only=True)
    department_id = serializers.PrimaryKeyRelatedField(queryset=Department.objects.all(), source='department', write_only=True)

    class Meta:
        model = Enrollment
        fields = ('id', 'student', 'student_id', 'department', 'department_id', 'academic_year', 'year')

class ItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = Item
        fields = '__all__'

class DepartmentItemRequirementSerializer(serializers.ModelSerializer):
    item_code = serializers.CharField(source='item.item_code', read_only=True)
    item_name = serializers.CharField(source='item.name', read_only=True)
    item_id = serializers.PrimaryKeyRelatedField(queryset=Item.objects.all(), source='item', write_only=True)

    class Meta:
        model = DepartmentItemRequirement
        fields = ('id', 'department', 'item_id', 'item_code', 'item_name', 'required_qty')

class ActivityLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivityLog
        fields = '__all__'

class IssueRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = IssueRecord
        fields = '__all__'

class PendingReportSerializer(serializers.ModelSerializer):
    # These quantity fields MUST be defined as SerializerMethodField to map 
    # the model names (pn2, pr2...) to the frontend names (qty_2PN, qty_2PR...).
    qty_2PN = serializers.SerializerMethodField()
    qty_2PR = serializers.SerializerMethodField()
    qty_2PO = serializers.SerializerMethodField()
    qty_1PN = serializers.SerializerMethodField()
    qty_1PR = serializers.SerializerMethodField()
    qty_1PO = serializers.SerializerMethodField()

    class Meta:
        model = PendingReport
        fields = (
            'id', 'student', 'usn', 'name', 'course', 'course_code', 'academic_year', 'year',
            'qty_2PN', 'qty_2PR', 'qty_2PO', 'qty_1PN', 'qty_1PR', 'qty_1PO'
        )

    # Method to retrieve course_code from the Student's Department
    def get_course_code(self, obj):
        return getattr(obj, 'course_code', None)

    # Methods to map MODEL fields (pn2, pr2, etc.) to SERIALIZER fields (qty_...)
    def get_qty_2PN(self, obj):
        return obj.pn2
    
    def get_qty_2PR(self, obj):
        return obj.pr2 

    def get_qty_2PO(self, obj):
        return obj.po2 
        
    def get_qty_1PN(self, obj):
        return obj.pn1
        
    def get_qty_1PR(self, obj):
        return obj.pr1 

    def get_qty_1PO(self, obj):
        return obj.po1


class HelpMessageSerializer(serializers.ModelSerializer):
    sender_username = serializers.CharField(source='sender.username', read_only=True)
    sender_role = serializers.CharField(source='sender.role', read_only=True)
    attachment_url = serializers.SerializerMethodField()
    attachment_name = serializers.SerializerMethodField()
    attachment_size = serializers.SerializerMethodField()

    class Meta:
        model = HelpMessage
        fields = (
            'id', 'thread', 'sender', 'sender_username', 'sender_role',
            'content', 'attachment', 'attachment_type', 'attachment_url', 'attachment_name', 'attachment_size',
            'created_at', 'is_admin_read', 'is_user_read'
        )
        read_only_fields = (
            'id', 'thread', 'sender', 'sender_username', 'sender_role',
            'attachment_url', 'attachment_name', 'attachment_size',
            'created_at', 'is_admin_read', 'is_user_read'
        )

    def get_attachment_url(self, obj):
        if obj.attachment:
            request = self.context.get('request') if hasattr(self, 'context') else None
            url = obj.attachment.url
            return request.build_absolute_uri(url) if request else url
        return None

    def get_attachment_name(self, obj):
        if obj.attachment:
            return obj.attachment.name.split('/')[-1]
        return None

    def get_attachment_size(self, obj):
        if obj.attachment:
            try:
                return obj.attachment.size
            except Exception:
                return None
        return None


class HelpThreadSerializer(serializers.ModelSerializer):
    user_username = serializers.CharField(source='user.username', read_only=True)
    user_role = serializers.CharField(source='user.role', read_only=True)
    messages = serializers.SerializerMethodField()

    class Meta:
        model = HelpThread
        fields = ('id', 'user', 'user_username', 'user_role', 'created_at', 'updated_at', 'messages')
        read_only_fields = ('id', 'user', 'user_username', 'user_role', 'created_at', 'updated_at', 'messages')

    def get_messages(self, obj):
        request = self.context.get('request') if hasattr(self, 'context') else None
        qs = obj.messages.all()
        if request is not None:
            user = getattr(request, 'user', None)
            if getattr(user, 'role', None) == User.Role.ADMIN:
                qs = qs.filter(is_admin_deleted=False)
            else:
                qs = qs.filter(is_user_deleted=False)
        return HelpMessageSerializer(qs, many=True, context=self.context).data


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ('id', 'message', 'link', 'notification_type', 'is_read', 'created_at')
        read_only_fields = ('id', 'message', 'link', 'notification_type', 'created_at')


class InventoryReceiptSerializer(serializers.ModelSerializer):
    order_id = serializers.PrimaryKeyRelatedField(
        queryset=InventoryOrder.objects.all(), source='order', allow_null=True, required=False
    )
    item_id = serializers.PrimaryKeyRelatedField(queryset=Item.objects.all(), source='item')
    item_code = serializers.CharField(source='item.item_code', read_only=True)
    item_name = serializers.CharField(source='item.name', read_only=True)
    available_qty = serializers.IntegerField(read_only=True)
    received_by_username = serializers.CharField(source='received_by.username', read_only=True)

    class Meta:
        model = InventoryReceipt
        fields = (
            'id', 'order_id', 'item_id', 'item_code', 'item_name', 'quantity',
            'consumed_qty', 'available_qty', 'note', 'received_at',
            'received_by', 'received_by_username'
        )
        read_only_fields = (
            'id', 'consumed_qty', 'available_qty', 'received_at',
            'received_by', 'received_by_username'
        )

    def validate(self, attrs):
        order = attrs.get('order')
        item = attrs.get('item')
        if order and item and order.item_id != item.id:
            raise serializers.ValidationError('Order item does not match the selected item.')
        return attrs


class InventoryOrderSerializer(serializers.ModelSerializer):
    item_id = serializers.PrimaryKeyRelatedField(queryset=Item.objects.all(), source='item')
    item_code = serializers.CharField(source='item.item_code', read_only=True)
    item_name = serializers.CharField(source='item.name', read_only=True)
    pending_qty = serializers.IntegerField(read_only=True)
    ordered_by_username = serializers.CharField(source='ordered_by.username', read_only=True)
    receipts = InventoryReceiptSerializer(many=True, read_only=True)

    class Meta:
        model = InventoryOrder
        fields = (
            'id', 'item_id', 'item_code', 'item_name', 'ordered_qty', 'received_qty',
            'pending_qty', 'status', 'reference', 'ordered_at', 'updated_at',
            'ordered_by', 'ordered_by_username', 'receipts'
        )
        read_only_fields = (
            'id', 'received_qty', 'pending_qty', 'status', 'ordered_at', 'updated_at',
            'ordered_by', 'ordered_by_username', 'receipts'
        )

    def validate(self, attrs):
        ordered_qty = attrs.get('ordered_qty', getattr(self.instance, 'ordered_qty', None))
        received_qty = attrs.get('received_qty', getattr(self.instance, 'received_qty', 0))
        if ordered_qty is not None and received_qty is not None and received_qty > ordered_qty:
            raise serializers.ValidationError('Received quantity cannot exceed ordered quantity.')
        return attrs


class StockLogEntrySerializer(serializers.ModelSerializer):
    item_id = serializers.PrimaryKeyRelatedField(queryset=Item.objects.all(), source='item')
    item_code = serializers.CharField(source='item.item_code', read_only=True)
    item_name = serializers.CharField(source='item.name', read_only=True)
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    order_id = serializers.PrimaryKeyRelatedField(
        queryset=InventoryOrder.objects.all(), source='order', allow_null=True,
        required=False
    )
    receipt_id = serializers.PrimaryKeyRelatedField(
        queryset=InventoryReceipt.objects.all(), source='receipt', allow_null=True,
        required=False
    )
    apply_change = serializers.BooleanField(required=False, default=True)

    class Meta:
        model = StockLogEntry
        fields = (
            'id', 'item_id', 'item_code', 'item_name', 'change', 'pending_delta', 'reason',
            'previous_quantity', 'new_quantity', 'created_at', 'created_by',
            'created_by_username', 'order_id', 'receipt_id', 'apply_change'
        )
        read_only_fields = (
            'id', 'created_at', 'created_by', 'created_by_username', 'order_id', 'receipt_id'
        )
